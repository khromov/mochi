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
  /** Ensure the tracking table exists and return its SQL-quoted (and on Postgres, schema-qualified) identifier. */
  ensureTable(sql: SQL, table: string): Promise<string>;
  begin<T>(sql: SQL, fn: (tx: SQL) => Promise<T>): Promise<T>;
  /** Guard called after user SQL inside `begin` and before recording the migration, catching early `COMMIT`/`ROLLBACK`. */
  verifyTransaction?(tx: SQL): Promise<void>;
  /** Reset per-file session state (e.g. Postgres `SET search_path`) without releasing the whole-run lock. */
  afterFile?(sql: SQL): Promise<void>;
}

const postgresDialect: MigrationDialect = {
  async open(storage) {
    // One pinned connection (the session advisory lock must share a session with every statement of the run) and
    // no named prepared statements (each statement runs once, and PGlite-over-socket shares one backend session).
    return new SQL({ adapter: 'postgres', url: (storage as { url: string }).url.trim(), max: 1, prepare: false });
  },
  async lock(sql) {
    // Session-level advisory lock held for the whole run so concurrent runners (e.g. replicas booting) serialize.
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`;
    return async () => {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`;
    };
  },
  async ensureTable(sql, table) {
    // Pin the initial schema now so a migration running `SET search_path TO …` cannot redirect tracking writes elsewhere.
    const rows = (await sql`SELECT coalesce(current_schema(), 'public') AS schema`) as { schema: string }[];
    const schema = (rows[0]?.schema ?? 'public').replaceAll('"', '""');
    const qualified = `"${schema}"."${table}"`;
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS ${qualified} (
        id         integer PRIMARY KEY,
        name       text NOT NULL,
        hash       text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`,
    );
    return qualified;
  },
  begin(sql, fn) {
    return sql.begin(fn) as ReturnType<typeof fn>;
  },
  async afterFile(sql) {
    // Postgres `SET` inside a transaction persists on the session after COMMIT; RESET ALL restores session defaults
    // (so file N+1 behaves the same on fresh and incremental runs) without releasing session advisory locks.
    await sql.unsafe('RESET ALL');
  },
};

const sqliteDialect: MigrationDialect = {
  // No `lock`: cross-process SQLite runners rely on BEGIN IMMEDIATE per migration plus the in-transaction
  // already-applied re-checks in the runner, so a losing racer skips instead of re-running.
  async open(storage) {
    const resolved = path.resolve((storage as { path: string }).path.trim());
    // bun:sqlite won't create the parent directory.
    mkdirSync(path.dirname(resolved), { recursive: true });
    const sql = new SQL({ adapter: 'sqlite', filename: resolved });
    await sql.unsafe('PRAGMA busy_timeout = 30000');
    return sql;
  },
  async ensureTable(sql, table) {
    const quoted = `"${table}"`;
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS ${quoted} (
        id         integer PRIMARY KEY,
        name       text NOT NULL,
        hash       text NOT NULL,
        applied_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
    );
    return quoted;
  },
  async begin(sql, fn) {
    // BEGIN IMMEDIATE takes the write lock upfront (avoids SQLITE_BUSY on lock upgrade); the savepoint detects
    // a migration that embeds its own COMMIT/ROLLBACK before the tracking row can autocommit.
    await sql.unsafe('BEGIN IMMEDIATE');
    await sql.unsafe('SAVEPOINT __mochi_mig');
    try {
      const result = await fn(sql);
      await sql.unsafe('COMMIT');
      return result;
    } catch (err) {
      await sql.unsafe('ROLLBACK').catch(() => {});
      throw err;
    }
  },
  async verifyTransaction(tx) {
    try {
      await tx.unsafe('RELEASE __mochi_mig');
    } catch {
      throw new Error('Migration ended its transaction early (explicit COMMIT or ROLLBACK) — remove transaction control statements or add "-- migrate:no-transaction".');
    }
  },
};

export function dialectFor(storage: MochiStorage): MigrationDialect {
  return storage.type === 'sqlite' ? sqliteDialect : postgresDialect;
}
