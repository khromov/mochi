import { SQL } from 'bun';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CACHE_TABLE, cacheMigrations } from './migrations';
import { applyStoreMigrations } from '../migrations/storeMigrations';
import { pinGlobal } from '../utils/globalState';
import type { PostgresConnectionOptions } from '../utils/postgresUrl';

/** Internal limits of the SQL cache backends. Not public API: exported so tests can shrink them. */
export const sqlCacheTuning = {
  /** Postgres connections per database, shared by every namespace on it. */
  poolMax: 4,
  idleTimeoutSeconds: 30,
  connectionTimeoutSeconds: 5,
  /** Client-side limit on one Postgres cache statement. */
  queryTimeoutMs: 5_000,
  /** Limit on opening the database and applying the cache schema. */
  initTimeoutMs: 10_000,
  /** How long calls fail fast after the database was unreachable or too slow. */
  unavailableCooldownMs: 5_000,
  /** How long writes fail fast after SQLite reported the write lock busy. */
  busyCooldownMs: 1_000,
  /** SQLite waits for a lock by sleeping the only thread, so a cache statement gives up quickly and reads as a miss. */
  sqliteBusyTimeoutMs: 250,
  /** Opening and migrating happens once per process, where waiting out a peer's cold boot beats failing. */
  sqliteInitBusyTimeoutMs: 5_000,
  sweepBatchSize: 1_000,
};

export type SqlTarget = { type: 'sqlite'; key: string; file: string } | { type: 'postgres'; key: string; options: PostgresConnectionOptions };

/** A `sweep` is a write whose own failure does not count against the backend: slow maintenance must not switch foreground caching off. */
export type OpKind = 'read' | 'write' | 'sweep';

/** A lazy Bun.SQL query: it starts when awaited, and `cancel()` asks Postgres to stop it. */
export interface SqlQuery<T> extends PromiseLike<T> {
  cancel?(): unknown;
}

export type SqlOp<T> = (sql: SQL, table: string, type: SqlTarget['type']) => SqlQuery<T>;

class SqlCacheTimeoutError extends Error {
  override name = 'SqlCacheTimeoutError';
}

/** Thrown without touching the database while a recent failure's cool-off lasts. */
export class SqlCacheUnavailableError extends Error {
  override name = 'SqlCacheUnavailableError';
}

interface Failure {
  scope: 'all' | 'write';
  cooldownMs: number;
}

const POSTGRES_UNREACHABLE = /^ERR_POSTGRES_(CONNECTION|IDLE_TIMEOUT|LIFETIME_TIMEOUT|TLS|\w*AUTHENTICATION|INVALID_SERVER|SASL|CHANNEL_BINDING)/;
// Connection exceptions, failed logins, a missing database, resource exhaustion, operator intervention (which includes
// a cancelled statement), system errors, and lock_timeout.
const POSTGRES_UNAVAILABLE_SQLSTATE = /^(08|28|3D|53|57|58)|^55P03$/;
const SQLITE_CONTENDED = /^SQLITE_(BUSY|LOCKED)/;
const SQLITE_UNUSABLE = /^SQLITE_(IOERR|FULL|CANTOPEN|READONLY|CORRUPT|NOTADB|PROTOCOL|NOMEM)/;

export function isSqliteBusy(err: unknown): boolean {
  return SQLITE_CONTENDED.test(String((err as { code?: unknown } | null)?.code ?? ''));
}

// Only failures that say the backend itself is unreachable, overloaded or locked trip the gate; an error about one
// statement's data must not switch the cache off for every other key.
function failureOf(err: unknown, kind: OpKind): Failure | undefined {
  if (err instanceof SqlCacheTimeoutError) {
    return { scope: 'all', cooldownMs: sqlCacheTuning.unavailableCooldownMs };
  }
  const { code, errno } = (err ?? {}) as { code?: unknown; errno?: unknown };
  const name = String(code ?? '');
  // WAL readers never wait for the writer, so a busy write lock stops writes only.
  const sqliteScope = kind === 'write' ? 'write' : 'all';
  if (SQLITE_CONTENDED.test(name)) {
    return { scope: sqliteScope, cooldownMs: sqlCacheTuning.busyCooldownMs };
  }
  if (SQLITE_UNUSABLE.test(name)) {
    return { scope: sqliteScope, cooldownMs: sqlCacheTuning.unavailableCooldownMs };
  }
  if (POSTGRES_UNREACHABLE.test(name) || (name === 'ERR_POSTGRES_SERVER_ERROR' && POSTGRES_UNAVAILABLE_SQLSTATE.test(String(errno ?? '')))) {
    return { scope: 'all', cooldownMs: sqlCacheTuning.unavailableCooldownMs };
  }
  return undefined;
}

/**
 * Circuit breaker shared by every cache on one database. After a failure it rejects calls at once for a cool-off, then
 * lets a single probe through; the others keep failing fast until that probe answers.
 */
class FailureGate {
  private until = { all: 0, write: 0 };
  private probing = false;
  private lastError: unknown;

  constructor(private readonly label: string) {}

  /** Returns whether this call is the probe; throws while calls must fail fast. */
  admit(kind: OpKind): boolean {
    const until = kind === 'read' ? this.until.all : Math.max(this.until.all, this.until.write);
    if (until === 0) {
      return false;
    }
    const remaining = until - Date.now();
    if (remaining > 0 || this.probing) {
      const reason = this.lastError instanceof Error ? this.lastError.message : String(this.lastError);
      const wait = remaining > 0 ? `for another ${remaining}ms` : 'until the retry in flight answers';
      throw new SqlCacheUnavailableError(`${this.label}: backend unavailable, failing fast ${wait} (${reason})`, { cause: this.lastError });
    }
    this.probing = true;
    return true;
  }

  /** `'neutral'` settles a call that says nothing about the backend either way, leaving the gate as it was. */
  settle(kind: OpKind, probe: boolean, outcome: 'ok' | 'neutral' | Failure, error?: unknown): void {
    if (probe) {
      this.probing = false;
    }
    if (typeof outcome === 'object') {
      this.until[outcome.scope] = Date.now() + outcome.cooldownMs;
      this.lastError = error;
    } else if (probe && outcome === 'ok') {
      this.until.all = 0;
      if (kind !== 'read') {
        this.until.write = 0;
      }
    }
  }
}

function withTimeout<T>(query: SqlQuery<T>, ms: number, describe: () => string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SqlCacheTimeoutError(describe()));
      // Frees the pooled connection; the query's own late rejection is absorbed by the handlers below.
      try {
        query.cancel?.();
      } catch {
        /* the query had already settled */
      }
    }, ms);
    query.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function journalMode(rows: unknown): string {
  return String((rows as { journal_mode?: unknown }[])[0]?.journal_mode ?? '').toLowerCase();
}

// The switch to WAL takes its lock on a path SQLite's busy handler does not cover, so a peer's write or its own switch
// fails this one at once whatever busy_timeout says; retry with jitter so cold-booting processes don't stay in step.
async function enableWal(sql: SQL, file: string): Promise<void> {
  const deadline = Date.now() + sqlCacheTuning.sqliteInitBusyTimeoutMs;
  for (let attempt = 0; ; attempt++) {
    let problem: string;
    try {
      if (journalMode(await sql.unsafe('PRAGMA journal_mode')) === 'wal') {
        return;
      }
      const mode = journalMode(await sql.unsafe('PRAGMA journal_mode = WAL'));
      if (mode === 'wal') {
        return;
      }
      problem = `journal_mode stayed "${mode}"`;
    } catch (err) {
      if (!isSqliteBusy(err)) {
        throw err;
      }
      problem = (err as Error).message;
    }
    if (Date.now() >= deadline) {
      throw new Error(`SqliteStorage: could not switch ${file} to WAL mode within ${sqlCacheTuning.sqliteInitBusyTimeoutMs}ms (${problem}).`);
    }
    await Bun.sleep(Math.min(200, 5 * 2 ** attempt) * (0.5 + Math.random()));
  }
}

interface Connection {
  sql: SQL;
  table: string;
}

/**
 * One SQL client per database, shared by every `SqliteStorage` / `PostgresStorage` instance and namespace on it and
 * closed when the last of them releases it — so dev reloads and extra namespaces never multiply connections.
 */
class SqlBackend {
  private refs = 0;
  private opened = false;
  private connection?: Promise<Connection>;
  private readonly gate: FailureGate;
  private readonly label: string;

  constructor(private readonly target: SqlTarget) {
    this.label = target.type === 'sqlite' ? 'SqliteStorage' : 'PostgresStorage';
    this.gate = new FailureGate(this.label);
  }

  get references(): number {
    return this.refs;
  }

  retain(): void {
    this.refs++;
  }

  /** Drop one reference; the last one closes the client. Resolves once this backend holds no open client on its behalf. */
  async release(): Promise<void> {
    if (--this.refs > 0) {
      return;
    }
    if (backends.get(this.target.key) === this) {
      backends.delete(this.target.key);
    }
    const connection = this.connection;
    this.connection = undefined;
    const opened = await connection?.catch(() => undefined);
    // Bounded, so a statement stuck on the server cannot hold dispose() forever.
    await opened?.sql.close({ timeout: 5 }).catch(() => {});
  }

  /** `afterOpening` runs only for a call that had to wait for the database to open, and may throw to abandon it. */
  async run<T>(kind: OpKind, op: SqlOp<T>, afterOpening?: () => void): Promise<T> {
    // A released backend has left the registry, so a client opened now would never be closed.
    if (this.refs <= 0) {
      throw new Error(`${this.label}: the database client was released.`);
    }
    const probe = this.gate.admit(kind);
    let connected = false;
    try {
      const waited = !this.opened;
      const { sql, table } = await this.connect();
      connected = true;
      if (waited) {
        afterOpening?.();
      }
      const query = op(sql, table, this.target.type);
      // SQLite runs the statement inside the call that starts it, where no timer can fire; busy_timeout bounds it instead.
      const result =
        this.target.type === 'postgres'
          ? await withTimeout(query, sqlCacheTuning.queryTimeoutMs, () => `${this.label}: statement exceeded ${sqlCacheTuning.queryTimeoutMs}ms`)
          : await query;
      this.gate.settle(kind, probe, 'ok');
      return result;
    } catch (err) {
      if (!connected) {
        // A failed open is not retried, and the schema not re-applied, until the cool-off ends.
        this.gate.settle(kind, probe, { scope: 'all', cooldownMs: sqlCacheTuning.unavailableCooldownMs }, err);
      } else {
        // An error about one statement's data means the backend answered, which is all a probe needs to know.
        this.gate.settle(kind, probe, kind === 'sweep' ? 'neutral' : (failureOf(err, kind) ?? 'ok'), err);
      }
      throw err;
    }
  }

  private connect(): Promise<Connection> {
    if (!this.connection) {
      const attempt = this.target.type === 'sqlite' ? this.openSqlite(this.target.file) : this.openPostgres(this.target.options);
      this.connection = attempt;
      attempt.then(
        () => {
          this.opened = this.connection === attempt;
        },
        () => {
          if (this.connection === attempt) {
            this.connection = undefined;
          }
        },
      );
    }
    return this.connection;
  }

  private async openSqlite(file: string): Promise<Connection> {
    mkdirSync(dirname(file), { recursive: true });
    const sql = new SQL({ adapter: 'sqlite', filename: file });
    try {
      await sql.unsafe(`PRAGMA busy_timeout = ${sqlCacheTuning.sqliteInitBusyTimeoutMs}`);
      await enableWal(sql, file);
      // Without an fsync per write the lock is held a fraction as long; in WAL mode this risks only the newest entries on power loss, never the file.
      await sql.unsafe('PRAGMA synchronous = NORMAL');
      const { qualify } = await applyStoreMigrations(sql, 'sqlite', cacheMigrations);
      await sql.unsafe(`PRAGMA busy_timeout = ${sqlCacheTuning.sqliteBusyTimeoutMs}`);
      return { sql, table: qualify(CACHE_TABLE) };
    } catch (err) {
      await sql.close().catch(() => {});
      throw err;
    }
  }

  private async openPostgres(options: PostgresConnectionOptions): Promise<Connection> {
    // Unnamed statements, autocommit single statements and one transaction-scoped schema step: nothing depends on
    // session state, so this also works behind a transaction-mode pooler.
    const sql = new SQL({
      adapter: 'postgres',
      ...options,
      max: sqlCacheTuning.poolMax,
      idleTimeout: sqlCacheTuning.idleTimeoutSeconds,
      connectionTimeout: sqlCacheTuning.connectionTimeoutSeconds,
      prepare: false,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const migrated = applyStoreMigrations(sql, 'postgres', cacheMigrations, { lockTimeoutMs: sqlCacheTuning.initTimeoutMs });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SqlCacheTimeoutError(`${this.label}: opening the database exceeded ${sqlCacheTuning.initTimeoutMs}ms`)), sqlCacheTuning.initTimeoutMs);
      });
      const { qualify } = await Promise.race([migrated, timeout]);
      return { sql, table: qualify(CACHE_TABLE) };
    } catch (err) {
      void sql.close({ timeout: 0 }).catch(() => {});
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// Pinned so duplicate bundled copies of the framework (the server runtime and each SSR chunk) share one client per database.
const backends = pinGlobal('__mochi_cache_sql_backends__', () => new Map<string, SqlBackend>());

export type SqlBackendHandle = Pick<SqlBackend, 'run' | 'release'>;

export function acquireSqlBackend(target: SqlTarget): SqlBackendHandle {
  let backend = backends.get(target.key);
  if (!backend) {
    backend = new SqlBackend(target);
    backends.set(target.key, backend);
  }
  backend.retain();
  return backend;
}

/** Open backends and the references held on them, for tests. */
export function sqlBackendStats(): { backends: number; references: number } {
  let references = 0;
  for (const backend of backends.values()) {
    references += backend.references;
  }
  return { backends: backends.size, references };
}
