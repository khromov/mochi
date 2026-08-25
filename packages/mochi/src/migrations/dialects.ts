import { SQL } from 'bun';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { MochiStorage } from './storage';

/** Fixed key for the Postgres session-level advisory lock that serializes concurrent migration runs ('moch' in ASCII). */
const MIGRATION_LOCK_KEY = 1836016488;

export interface MigrationDialect {
  open(storage: MochiStorage): Promise<SQL>;
  /** Take a whole-run exclusive lock; returns the release function. */
  lock?(sql: SQL): Promise<() => Promise<void>>;
  ensureTable(sql: SQL, table: string): Promise<void>;
  begin<T>(sql: SQL, fn: (tx: SQL) => Promise<T>): Promise<T>;
}

const postgresDialect: MigrationDialect = {
  async open(storage) {
    // One pinned connection (the session advisory lock must share a session with every statement of the run) and
    // no named prepared statements (each statement runs once, and PGlite-over-socket shares one backend session).
    return new SQL({ url: (storage as { url: string }).url, max: 1, prepare: false });
  },
  async lock(sql) {
    // Session-level advisory lock held for the whole run so concurrent runners (e.g. replicas booting) serialize.
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`;
    return async () => {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`;
    };
  },
  async ensureTable(sql, table) {
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "${table}" (
        id         integer PRIMARY KEY,
        name       text NOT NULL,
        hash       text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`,
    );
  },
  begin(sql, fn) {
    return sql.begin(fn) as ReturnType<typeof fn>;
  },
};

const sqliteDialect: MigrationDialect = {
  // No `lock`: cross-process SQLite runners rely on BEGIN IMMEDIATE per migration plus the in-transaction
  // already-applied re-check in the runner, so a losing racer skips instead of re-running.
  async open(storage) {
    const file = (storage as { path: string }).path;
    // bun:sqlite won't create the parent directory.
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const sql = new SQL(`sqlite://${file}`);
    await sql.unsafe('PRAGMA busy_timeout = 30000');
    return sql;
  },
  async ensureTable(sql, table) {
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS "${table}" (
        id         integer PRIMARY KEY,
        name       text NOT NULL,
        hash       text NOT NULL,
        applied_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
    );
  },
  async begin(sql, fn) {
    // BEGIN IMMEDIATE takes the write lock upfront (avoids SQLITE_BUSY on lock upgrade); SQLite is a single
    // connection here, so manual bracketing on `sql` is sound.
    await sql.unsafe('BEGIN IMMEDIATE');
    try {
      const result = await fn(sql);
      await sql.unsafe('COMMIT');
      return result;
    } catch (err) {
      await sql.unsafe('ROLLBACK').catch(() => {});
      throw err;
    }
  },
};

export function dialectFor(storage: MochiStorage): MigrationDialect {
  return storage.type === 'sqlite' ? sqliteDialect : postgresDialect;
}
