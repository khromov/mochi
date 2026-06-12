import { Database, type Statement } from 'bun:sqlite';
import type { Storage } from '../cache';

export interface SqliteStorageOptions {
  /** Table that holds cache entries. Created if missing. Defaults to `mochi_cache`. */
  table?: string;
}

/** What SQLite can bind directly — the shape `serialize` must produce. */
type SqliteValue = string | number | bigint | Uint8Array | null;

/**
 * `bun:sqlite`-backed storage for `MochiCache`. Persists entries across
 * restarts and lets multiple processes share one cache file.
 *
 * SQLite stores text/blobs, not objects, so pair this with `serialize` /
 * `deserialize` on the cache (e.g. `serialize: JSON.stringify, deserialize:
 * JSON.parse`) so each entry is written as a single string.
 */
export class SqliteStorage implements Storage {
  private readonly db: Database;
  private readonly getStmt: Statement;
  private readonly setStmt: Statement;
  private readonly removeStmt: Statement;
  private readonly clearStmt: Statement;

  constructor(database: Database | string = ':memory:', options: SqliteStorageOptions = {}) {
    this.db = typeof database === 'string' ? new Database(database) : database;
    const table = options.table ?? 'mochi_cache';
    // Table names can't be bound as parameters, so guard against injection.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`SqliteStorage: invalid table name "${table}".`);
    }

    this.db.run('PRAGMA journal_mode = WAL;');
    // `value` is left untyped so it keeps BLOB affinity — strings and buffers
    // are stored verbatim rather than coerced to a numeric type.
    this.db.run(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value)`);

    this.getStmt = this.db.query(`SELECT value FROM ${table} WHERE key = ?`);
    this.setStmt = this.db.query(`INSERT INTO ${table} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    this.removeStmt = this.db.query(`DELETE FROM ${table} WHERE key = ?`);
    this.clearStmt = this.db.query(`DELETE FROM ${table}`);
  }

  getItem(key: string): unknown {
    const row = this.getStmt.get(key) as { value: unknown } | null;
    return row == null ? null : row.value;
  }

  setItem(key: string, value: unknown): void {
    this.setStmt.run(key, value as SqliteValue);
  }

  removeItem(key: string): void {
    this.removeStmt.run(key);
  }

  clear(): void {
    this.clearStmt.run();
  }
}
