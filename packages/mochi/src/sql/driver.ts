/**
 * The single isolation boundary around the SQL backends, so `SqlStorage` and `SqlLeaseStore` share one
 * dialect-agnostic interface.
 *
 * SQLite goes through `bun:sqlite`, not `Bun.SQL`: the latter pools connections and a `PRAGMA
 * busy_timeout` applies only to the connection that ran it, so a fresh pooled connection throws
 * `SQLITE_BUSY` the moment a peer holds a write lock. Postgres keeps `Bun.SQL`, where pooling is right.
 */
import { Database } from 'bun:sqlite';
import { SQL } from 'bun';

export type SqlDialect = 'sqlite' | 'postgres';

export interface SqlDriver {
  readonly dialect: SqlDialect;
  /** Run a statement with `$name` placeholders. Returns rows — empty for a write without `RETURNING`. */
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
  close(): Promise<void>;
}

/** MySQL is rejected up front because the upsert this codebase relies on has no MySQL equivalent, and failing later gives a syntax error nobody can act on. */
export function resolveDialect(url: string): SqlDialect {
  if (url === ':memory:' || url.startsWith('sqlite:') || url.startsWith('file:') || url.endsWith('.db') || url.endsWith('.sqlite') || url.endsWith('.sqlite3')) {
    return 'sqlite';
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return 'postgres';
  }
  if (url.startsWith('mysql://') || url.startsWith('mysql2://')) {
    throw new Error(`Mochi SQL: MySQL is not supported ("${url}"). Use a sqlite:// or postgres:// URL — the atomic upsert Mochi relies on has no MySQL equivalent.`);
  }
  throw new Error(`Mochi SQL: could not tell which database "${url}" refers to. Use a sqlite:// (or a path ending in .db/.sqlite) or postgres:// URL.`);
}

function sqlitePath(url: string): string {
  if (url === ':memory:') {
    return ':memory:';
  }
  const withoutScheme = url.replace(/^sqlite:\/\/|^sqlite:|^file:\/\/|^file:/, '');
  return withoutScheme === '' ? ':memory:' : withoutScheme;
}

const NAMED_PARAM = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

/** Every query is written once in the `$name` form; only this function knows Postgres numbers its parameters. A repeated name reuses its original position. */
export function toPositional(sql: string, params: Record<string, unknown>): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const positions = new Map<string, number>();
  const text = sql.replace(NAMED_PARAM, (_match, name: string) => {
    let position = positions.get(name);
    if (position === undefined) {
      if (!(name in params)) {
        throw new Error(`Mochi SQL: no value supplied for parameter "$${name}".`);
      }
      values.push(params[name]);
      position = values.length;
      positions.set(name, position);
    }
    return `$${position}`;
  });
  return { text, values };
}

class SqliteDriver implements SqlDriver {
  readonly dialect = 'sqlite' as const;
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    // Order matters: enabling WAL takes an exclusive lock, so the busy timeout has
    // to already be in place for the pragma below to wait rather than throw.
    this.db.exec('PRAGMA busy_timeout = 5000');
    // SQLite skips the busy handler for a journal_mode change, so a peer flipping
    // it at the same instant returns SQLITE_BUSY — harmless, since it is setting
    // the same value. Read-first avoided ~1 in 60 concurrent boots dying here.
    try {
      const mode = (this.db.query('PRAGMA journal_mode').get() as { journal_mode?: string } | null)?.journal_mode;
      if (mode !== 'wal') {
        this.db.exec('PRAGMA journal_mode = WAL');
      }
    } catch {
      // A peer won the race; WAL is already being established.
    }
  }

  async query<T = Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
    // bun:sqlite needs the `$` prefix on keys — a bare key binds as NULL rather
    // than throwing, surfacing later as a confusing NOT NULL constraint failure.
    const bound: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      bound[`$${key}`] = value;
    }
    return this.db.query(sql).all(bound as never) as T[];
  }

  async close(): Promise<void> {
    // Required on Windows before a test can remove the file, same as `SqliteNonceStore`.
    this.db.close();
  }
}

class PostgresDriver implements SqlDriver {
  readonly dialect = 'postgres' as const;
  private sql: SQL;

  constructor(url: string) {
    this.sql = new SQL(url);
  }

  async query<T = Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const { text, values } = toPositional(sql, params);
    return (await this.sql.unsafe(text, values as never[])) as T[];
  }

  async close(): Promise<void> {
    await this.sql.close();
  }
}

export function createSqlDriver(url: string): SqlDriver {
  const dialect = resolveDialect(url);
  return dialect === 'sqlite' ? new SqliteDriver(sqlitePath(url)) : new PostgresDriver(url);
}

/** Postgres needs `BIGINT` explicitly for a ms epoch and hands those back as strings, which is why every read goes through {@link toNumber}. */
export function timestampColumn(dialect: SqlDialect): string {
  return dialect === 'sqlite' ? 'INTEGER' : 'BIGINT';
}

/** Coerce a driver-returned numeric column to a JS number, tolerating Postgres's stringified BIGINT. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
