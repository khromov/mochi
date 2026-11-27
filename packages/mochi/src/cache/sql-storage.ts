import { resolve } from 'node:path';
import type { Storage, SweepOptions, SweepResult } from './cache';
import { acquireSqlBackend, sqlCacheTuning, type OpKind, type SqlBackendHandle, type SqlOp, type SqlTarget } from './sql-backend';
import { mochiEvents } from '../events';
import { isValidStorage } from '../migrations/storage';
import { isBuildingEntry } from '../utils/buildFlag';
import { pinGlobal } from '../utils/globalState';
import { logger } from '../utils/log';
import { parsePostgresUrl } from '../utils/postgresUrl';

interface SweeperOwner {
  stop(): void;
}

const sweeperOwners = pinGlobal('__mochi_cache_sweeper_owners__', () => new Map<string, SweeperOwner>());

// Signed 32-bit timer ceiling in Bun/Node; larger delays overflow `setInterval` and clamp to 1ms.
const MAX_TIMER_MS = 2_147_483_647;
const COMMON_OPTION_KEYS = new Set(['namespace', 'purgeOnInit', 'purgeInterval', 'maxAge']);

interface InlineBinary {
  __mochiBinary: string;
}

interface ValueEnvelope {
  __mochiValue: unknown;
}

function isInlineBinary(value: unknown): value is InlineBinary {
  return typeof value === 'object' && value !== null && typeof (value as { __mochiBinary?: unknown }).__mochiBinary === 'string' && Object.keys(value).length === 1;
}

function isValueEnvelope(value: unknown): value is ValueEnvelope {
  return typeof value === 'object' && value !== null && '__mochiValue' in value;
}

// Mirrors `FileStorage.encodeBlobs` with offloading off — every non-null object is walked, class instances included —
// so a value reads back the same from any backend.
function encodeInlineValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { __mochiBinary: Buffer.from(value).toString('base64') } satisfies InlineBinary;
  }
  if (Array.isArray(value)) {
    return value.map(encodeInlineValue);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      Object.defineProperty(out, k, { value: encodeInlineValue(v), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}

function decodeInlineValue(value: unknown): unknown {
  if (isInlineBinary(value)) {
    return new Uint8Array(Buffer.from(value.__mochiBinary, 'base64'));
  }
  if (Array.isArray(value)) {
    return value.map(decodeInlineValue);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      Object.defineProperty(out, k, { value: decodeInlineValue(v), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}

// Rows are keyed by this digest, as `FileStorage` names its files, so a key of any length or content fits the index.
function hashKey(key: string): string {
  return new Bun.CryptoHasher('sha256').update(key).digest('hex');
}

const yieldToEventLoop = (): Promise<void> => new Promise((done) => setImmediate(done));

/**
 * One sweep batch: delete up to `$3` rows of namespace `$1` older than `$2` (`$4` repeats `$2`). The batch is
 * addressed by physical row id because, for any lookup by column, each planner can decide (Postgres on stale statistics)
 * to walk the whole namespace once per batch. Exported for the tests that pin its plan.
 */
export function sweepBatchSql(type: SqlTarget['type'], table: string, reportKeys: boolean): string {
  const rowId = type === 'sqlite' ? 'rowid' : 'ctid';
  const batch = `SELECT ${rowId} FROM ${table} WHERE namespace = $1 AND written_at < $2 ORDER BY written_at LIMIT $3`;
  const picked = type === 'sqlite' ? `rowid IN (${batch})` : `ctid = ANY (ARRAY(${batch}))`;
  // The outer age check spares an entry rewritten since the batch picked it; its unary plus keeps it off every index.
  return `DELETE FROM ${table} WHERE ${picked} AND +written_at < $4${reportKeys ? ' RETURNING key_json' : ''}`;
}

function assertAllowedKeys(options: unknown, primaryKey: string, label: string): void {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    return;
  }
  for (const key of Object.keys(options)) {
    if (key !== primaryKey && !COMMON_OPTION_KEYS.has(key)) {
      throw new Error(`${label}: unknown option "${key}".`);
    }
  }
}

interface CommonSqlStorageOptions {
  /** Logical keyspace isolating this cache from other `MochiCache` instances sharing the same database. Default `'default'`. */
  namespace?: string;
  /** Delete this namespace's existing entries before serving reads or writes. Default `false`. */
  purgeOnInit?: boolean;
  /** Background sweep interval (ms) that deletes expired entries in this namespace. Default `60_000`. `<= 0` disables the sweeper. */
  purgeInterval?: number;
  /** Entries older than this (ms) are deleted by `sweep()`. Should be `>=` the cache's `maxTimeToLive`. Default `600_000`. */
  maxAge?: number;
}

export interface SqliteStorageOptions extends CommonSqlStorageOptions {
  /** SQLite database file path. Created along with parent directories if missing. */
  path: string;
}

export interface PostgresStorageOptions extends CommonSqlStorageOptions {
  /** Postgres connection URL (`postgres://…` or `postgresql://…`). */
  url: string;
}

abstract class SqlCacheStorage implements Storage {
  protected readonly namespace: string;
  private readonly maxAge: number;
  private readonly purgeOnInit: boolean;
  private purged = false;
  private purging?: Promise<void>;
  private backend?: SqlBackendHandle;
  private activeSweep?: Promise<void>;
  private disposePromise?: Promise<void>;
  private initialTimer?: ReturnType<typeof setTimeout>;
  private intervalTimer?: ReturnType<typeof setInterval>;
  private sweepKey?: string;
  private sweepOwner?: SweeperOwner;
  private disposed = false;

  protected constructor(
    private readonly target: SqlTarget,
    private readonly label: string,
    options: CommonSqlStorageOptions,
  ) {
    const namespace = options.namespace ?? 'default';
    if (typeof namespace !== 'string' || namespace.trim().length === 0 || namespace.includes('\0')) {
      throw new Error(`${label}: namespace must be a non-empty string without null bytes.`);
    }
    const maxAge = options.maxAge ?? 600_000;
    if (typeof maxAge !== 'number' || Number.isNaN(maxAge) || maxAge <= 0) {
      throw new Error(`${label}: maxAge must be a positive number.`);
    }
    const purgeInterval = options.purgeInterval ?? 60_000;
    if (typeof purgeInterval !== 'number' || !Number.isFinite(purgeInterval)) {
      throw new Error(`${label}: purgeInterval must be a finite number (or <= 0 to disable).`);
    }
    if (options.purgeOnInit !== undefined && typeof options.purgeOnInit !== 'boolean') {
      throw new Error(`${label}: purgeOnInit must be a boolean.`);
    }

    this.namespace = namespace;
    this.maxAge = maxAge;
    this.purgeOnInit = options.purgeOnInit ?? false;

    // Skip timers when maxAge is Infinity (nothing ever expires) or while `mochi-framework build` / `migrate` inspects the entry.
    if (purgeInterval > 0 && Number.isFinite(maxAge) && !isBuildingEntry()) {
      this.startSweeper(Math.min(purgeInterval, MAX_TIMER_MS));
    }
  }

  async getItem(key: string): Promise<unknown> {
    const rows = (await this.run('read', (sql, table) => sql.unsafe(`SELECT value FROM ${table} WHERE namespace = $1 AND key_hash = $2`, [this.namespace, hashKey(key)]))) as {
      value: string;
    }[];
    const row = rows[0];
    if (!row) {
      return null;
    }
    const parsed = JSON.parse(row.value);
    if (!isValueEnvelope(parsed)) {
      return null;
    }
    return decodeInlineValue(parsed.__mochiValue);
  }

  async setItem(key: string, value: unknown): Promise<void> {
    const envelope: ValueEnvelope = { __mochiValue: value === undefined ? null : encodeInlineValue(value) };
    const serialized = JSON.stringify(envelope);
    // The key is stored JSON-encoded because Postgres text cannot hold the NUL or lone surrogates a JS string can.
    // Ascending `$1..$5` order is required by Bun's sqlite adapter, which binds array parameters positionally.
    await this.run('write', (sql, table) =>
      sql.unsafe(
        `INSERT INTO ${table} (namespace, key_hash, key_json, value, written_at) VALUES ($1, $2, $3, $4, $5) ` +
          `ON CONFLICT (namespace, key_hash) DO UPDATE SET key_json = excluded.key_json, value = excluded.value, written_at = excluded.written_at`,
        [this.namespace, hashKey(key), JSON.stringify(key), serialized, Date.now()],
      ),
    );
  }

  async removeItem(key: string): Promise<void> {
    await this.run('write', (sql, table) => sql.unsafe(`DELETE FROM ${table} WHERE namespace = $1 AND key_hash = $2`, [this.namespace, hashKey(key)]));
  }

  async clear(): Promise<void> {
    await this.run('write', (sql, table) => sql.unsafe(`DELETE FROM ${table} WHERE namespace = $1`, [this.namespace]));
  }

  async count(): Promise<number> {
    const rows = (await this.run('read', (sql, table) => sql.unsafe(`SELECT count(*) AS n FROM ${table} WHERE namespace = $1`, [this.namespace]))) as {
      n: number | bigint | string;
    }[];
    return Number(rows[0]?.n ?? 0);
  }

  async keys(): Promise<string[]> {
    const rows = (await this.run('read', (sql, table) => sql.unsafe(`SELECT key_json FROM ${table} WHERE namespace = $1`, [this.namespace]))) as { key_json: string }[];
    return rows.map((row) => JSON.parse(row.key_json) as string);
  }

  /**
   * Delete entries older than `maxAge`, a bounded batch per statement with a yield in between, so a large backlog
   * neither holds SQLite's write lock (and the event loop with it) nor one long Postgres transaction.
   */
  async sweep(now: number = Date.now(), options: SweepOptions = {}): Promise<SweepResult> {
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      throw new Error(`${this.label}.sweep(): now must be a finite timestamp.`);
    }
    if (!Number.isFinite(this.maxAge)) {
      return options.reportKeys ? { removed: 0, removedKeys: [] } : { removed: 0 };
    }
    const cutoff = Math.floor(now - this.maxAge);
    const batchSize = sqlCacheTuning.sweepBatchSize;
    let removed = 0;
    const removedKeys: string[] = [];
    for (;;) {
      const result = (await this.run('sweep', (sql, table, type) =>
        sql.unsafe(sweepBatchSql(type, table, options.reportKeys === true), [this.namespace, cutoff, batchSize, cutoff]),
      )) as {
        key_json: string;
      }[] & { count?: number };
      // The driver reports affected rows, so nothing is materialised unless the caller asked for the keys.
      const deleted = options.reportKeys ? result.length : Number(result.count ?? 0);
      removed += deleted;
      for (const row of options.reportKeys ? result : []) {
        removedKeys.push(JSON.parse(row.key_json) as string);
      }
      if (deleted < batchSize) {
        break;
      }
      await yieldToEventLoop();
    }
    return options.reportKeys ? { removed, removedKeys } : { removed };
  }

  /** Stop the background sweep and release the shared database client, which closes once its last user has. */
  dispose(): Promise<void> {
    this.disposed = true;
    this.stopSweepTimers();
    if (this.sweepKey !== undefined && sweeperOwners.get(this.sweepKey) === this.sweepOwner) {
      sweeperOwners.delete(this.sweepKey);
    }
    this.sweepKey = undefined;
    this.sweepOwner = undefined;

    this.disposePromise ??= this.runDispose();
    return this.disposePromise;
  }

  private async runDispose(): Promise<void> {
    await this.purging?.catch(() => {});
    await this.activeSweep?.catch(() => {});
    await this.detach();
  }

  private detach(): Promise<void> {
    const backend = this.backend;
    this.backend = undefined;
    return backend ? backend.release() : Promise.resolve();
  }

  private async run<T>(kind: OpKind, op: SqlOp<T>): Promise<T> {
    if (this.disposed) {
      throw new Error(`${this.label} has been disposed.`);
    }
    // Attached on first use, and again after a newer instance took this one's reference over.
    const backend = (this.backend ??= acquireSqlBackend(this.target));
    if (this.purgeOnInit && !this.purged) {
      this.purging ??= backend
        .run('write', (sql, table) => sql.unsafe(`DELETE FROM ${table} WHERE namespace = $1`, [this.namespace]))
        .then(() => {
          this.purged = true;
        })
        .finally(() => {
          this.purging = undefined;
        });
      await this.purging;
    }
    // A call issued before dispose() still completes on an open database; one that was waiting for it to open does not.
    return backend.run(kind, op, () => {
      if (this.disposed) {
        throw new Error(`${this.label} has been disposed.`);
      }
    });
  }

  private stopSweepTimers(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }
    this.initialTimer = undefined;
    this.intervalTimer = undefined;
  }

  private startSweeper(intervalMs: number): void {
    const run = async (): Promise<void> => {
      if (this.disposed || this.activeSweep) {
        return;
      }
      const start = Date.now();
      const task = (async () => {
        try {
          const { removed } = await this.sweep(start);
          if (!this.disposed) {
            mochiEvents.emit('cache:sweep', { removed, durationMs: Date.now() - start });
          }
        } catch (err) {
          if (!this.disposed) {
            logger.warn(`Cache sweep failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      })();
      this.activeSweep = task;
      try {
        await task;
      } finally {
        if (this.activeSweep === task) {
          this.activeSweep = undefined;
        }
      }
    };

    // Keyed per (database, namespace) so HMR reloads replace dead sweepers while distinct namespaces keep their own maxAge schedule.
    const key = `${this.target.key}\0${this.namespace}`;
    sweeperOwners.get(key)?.stop();
    this.sweepKey = key;
    // A superseded instance is usually a dead HMR copy nobody can dispose(), so the takeover also drops its reference
    // on the shared client; if something still uses it, its next call simply attaches again.
    this.sweepOwner = {
      stop: () => {
        this.stopSweepTimers();
        void this.detach();
      },
    };

    this.initialTimer = setTimeout(run, 1_000);
    this.intervalTimer = setInterval(run, intervalMs);
    this.initialTimer.unref?.();
    this.intervalTimer.unref?.();
    sweeperOwners.set(key, this.sweepOwner);
  }
}

/**
 * SQLite-backed `Storage` for {@link MochiCache}. Creates its own `mochi_cache` table on first use, runs in WAL mode,
 * and isolates keys by `namespace` (default `'default'`) so multiple caches can share one `.db` file.
 */
export class SqliteStorage extends SqlCacheStorage {
  constructor(options: SqliteStorageOptions) {
    assertAllowedKeys(options, 'path', 'SqliteStorage');
    const trimmedPath = typeof options?.path === 'string' ? options.path.trim() : (options?.path as unknown as string);
    if (!isValidStorage({ type: 'sqlite', path: trimmedPath })) {
      throw new Error('SqliteStorage: expected a non-empty file `path` (":memory:" and "?" URI query strings are not supported; use MemoryStorage for in-memory caching).');
    }
    const file = resolve(trimmedPath);
    super({ type: 'sqlite', key: `sqlite:${file}`, file }, 'SqliteStorage', options);
  }
}

/**
 * Postgres-backed `Storage` for {@link MochiCache}. Creates its own `mochi_cache` table in the connection's current
 * schema on first use and isolates keys by `namespace` (default `'default'`) so multiple caches and server replicas
 * can share one database.
 */
export class PostgresStorage extends SqlCacheStorage {
  constructor(options: PostgresStorageOptions) {
    assertAllowedKeys(options, 'url', 'PostgresStorage');
    const trimmedUrl = typeof options?.url === 'string' ? options.url.trim() : (options?.url as unknown as string);
    if (!isValidStorage({ type: 'postgres', url: trimmedUrl })) {
      throw new Error('PostgresStorage: expected a `postgres://` or `postgresql://` connection `url`.');
    }
    const { options: connection, key } = parsePostgresUrl(trimmedUrl);
    super({ type: 'postgres', key, options: connection }, 'PostgresStorage', options);
  }
}
