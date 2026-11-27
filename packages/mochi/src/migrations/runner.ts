import type { SQL } from 'bun';
import type { Database } from 'bun:sqlite';
import { toPosixPath } from '../utils';
import { logger } from '../utils/log';
import { dialectFor, sqliteTrackingTableSql } from './dialects';
import { loadMigrationFiles, parseMigrationSources } from './loadMigrationFiles';
import type { MochiMigrationFile, MochiMigrationSource } from './loadMigrationFiles';
import { isValidStorage } from './storage';
import type { MochiStorage } from './storage';

const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface RunMigrationsOptions {
  storage: MochiStorage;
  /** Directory of `.sql` files for the storage's database type. */
  dir: string;
  /** Tracking table name (default `'mochi_migrations'`). */
  table?: string;
  /** Log prefix distinguishing runs, e.g. `'app'` or `'mochi'`. */
  label?: string;
}

export interface AppliedMigration {
  id: number;
  filename: string;
}

interface AppliedRow {
  id: number;
  name: string;
  hash: string;
}

function assertAppliedPrefix(applied: AppliedRow[], files: MochiMigrationFile[], dir: string, label: string): void {
  if (applied.length > files.length) {
    throw new Error(
      `The database has ${applied.length} applied ${label}migration(s) but only ${files.length} file(s) exist in ${toPosixPath(dir)} — applied migrations are immutable; restore the missing files.`,
    );
  }
  for (let i = 0; i < applied.length; i++) {
    const row = applied[i]!;
    const file = files[i]!;
    if (file.id !== row.id) {
      throw new Error(
        `Migration mismatch at position ${i + 1} in ${toPosixPath(dir)}: the database has id ${row.id} but the file has id ${file.id} ("${file.filename}") — applied migrations are immutable; don't renumber them.`,
      );
    }
    if (file.hash !== row.hash) {
      throw new Error(`Migration ${file.id} ("${toPosixPath(file.path)}") changed since it was applied — applied migrations are immutable; add a new migration instead.`);
    }
  }
}

/**
 * Apply any pending migrations from `opts.dir` to the database behind `opts.storage`. Forward-only: applied
 * migrations must remain an unchanged prefix of the files on disk (verified by hash). Returns the migrations
 * applied during this run; an empty or missing directory returns `[]` without touching the database.
 */
export async function runMigrations(opts: RunMigrationsOptions): Promise<AppliedMigration[]> {
  if (!isValidStorage(opts.storage)) {
    throw new Error(`runMigrations({ storage }): expected { type: 'sqlite', path: 'path/to.db' } or { type: 'postgres', url }.`);
  }
  const table = opts.table ?? 'mochi_migrations';
  if (!TABLE_NAME_PATTERN.test(table)) {
    throw new Error(`runMigrations({ table }): "${table}" is not a valid table name.`);
  }
  const files = await loadMigrationFiles(opts.dir);
  if (files.length === 0) {
    return [];
  }

  const label = opts.label ? `${opts.label} ` : '';
  const dialect = dialectFor(opts.storage);
  const sql = await dialect.open(opts.storage);
  try {
    const unlock = await dialect.lock?.(sql);
    try {
      const qualifiedTable = await dialect.ensureTable(sql, table);
      const applied = (await sql.unsafe(`SELECT id, name, hash FROM ${qualifiedTable} ORDER BY id`)) as AppliedRow[];

      assertAppliedPrefix(applied, files, opts.dir, label);

      const pending = files.slice(applied.length);
      if (pending.length === 0) {
        logger.debug(`${label}migrations up to date (${files.length} applied)`);
        return [];
      }

      // The applied-list above is read before any lock on SQLite, so a racer that just lost the write lock
      // re-checks its migration inside the transaction and skips instead of re-running the SQL.
      const alreadyApplied = async (conn: SQL, id: number) => ((await conn.unsafe(`SELECT id FROM ${qualifiedTable} WHERE id = $1`, [id])) as AppliedRow[]).length > 0;

      const result: AppliedMigration[] = [];
      for (const m of pending) {
        const executable = m.statements.length > 0;
        let appliedNow = true;
        try {
          if (m.noTransaction) {
            if (await alreadyApplied(sql, m.id)) {
              appliedNow = false;
            } else {
              // Not atomic with the record INSERT: the file must be idempotent so a re-run after a crash — or a
              // racing second SQLite process — succeeds; ON CONFLICT avoids a unique-key crash on the losing racer.
              if (executable) {
                await sql.unsafe(m.contents);
              }
              const inserted = (await sql.unsafe(`INSERT INTO ${qualifiedTable} (id, name, hash) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id`, [
                m.id,
                m.name,
                m.hash,
              ])) as { id: number }[];
              appliedNow = inserted.length > 0;
            }
          } else {
            appliedNow = await dialect.begin(sql, async (tx) => {
              if (await alreadyApplied(tx, m.id)) {
                return false;
              }
              if (executable) {
                await tx.unsafe(m.contents);
              }
              await dialect.verifyTransaction?.(tx);
              await tx.unsafe(`INSERT INTO ${qualifiedTable} (id, name, hash) VALUES ($1, $2, $3)`, [m.id, m.name, m.hash]);
              return true;
            });
          }
        } catch (err) {
          logger.error(`${label}migration failed: ${m.filename}`);
          throw err;
        }
        if (!appliedNow) {
          logger.debug(`${label}migration already applied by a concurrent runner: ${m.filename}`);
          continue;
        }
        logger.info(`applied ${label}migration: ${m.filename}`);
        result.push({ id: m.id, filename: m.filename });
      }
      return result;
    } finally {
      // Cleanup must never mask the migration error that is already propagating.
      await unlock?.().catch((err) => logger.debug(`${label}migration unlock failed:`, err));
    }
  } finally {
    await sql.close().catch((err) => logger.debug(`${label}migration connection close failed:`, err));
  }
}

// Finalized at once rather than left in `db.query()`'s cache, which `close()` drops without finalizing, holding the file open on Windows.
function queryOnce<T>(db: Database, sql: string, ...params: number[]): T[] {
  const stmt = db.prepare(sql);
  try {
    return stmt.all(...params) as T[];
  } finally {
    stmt.finalize();
  }
}

export interface RunSqliteMigrationsSyncOptions {
  /** Labels the migrations in messages, like `RunMigrationsOptions.dir`. */
  dir: string;
  sources: MochiMigrationSource[];
  table: string;
  label: string;
}

/**
 * The SQLite path of `runMigrations`, run synchronously on a framework store's own `bun:sqlite` handle so a store with a
 * synchronous API can migrate in its constructor, including a `:memory:` database no second connection could reach.
 */
export function runSqliteMigrationsSync(db: Database, opts: RunSqliteMigrationsSyncOptions): AppliedMigration[] {
  const label = `${opts.label} `;
  const files = parseMigrationSources(opts.dir, opts.sources);
  const table = `"${opts.table}"`;
  db.run(sqliteTrackingTableSql(table));
  const applied = queryOnce<AppliedRow>(db, `SELECT id, name, hash FROM ${table} ORDER BY id`);
  assertAppliedPrefix(applied, files, opts.dir, label);

  const result: AppliedMigration[] = [];
  for (const m of files.slice(applied.length)) {
    if (m.noTransaction) {
      throw new Error(`${label}migration "${m.filename}" uses -- migrate:no-transaction, which a synchronous store migration does not support.`);
    }
    // Same protocol as the async SQLite runner: take the write lock up front, then skip if a racing process recorded it first.
    db.run('BEGIN IMMEDIATE');
    let appliedNow: boolean;
    try {
      appliedNow = queryOnce(db, `SELECT id FROM ${table} WHERE id = ?`, m.id).length === 0;
      if (appliedNow) {
        if (m.statements.length > 0) {
          db.run(m.contents);
        }
        db.run(`INSERT INTO ${table} (id, name, hash) VALUES (?, ?, ?)`, [m.id, m.name, m.hash]);
      }
      db.run('COMMIT');
    } catch (err) {
      if (db.inTransaction) {
        db.run('ROLLBACK');
      }
      logger.error(`${label}migration failed: ${m.filename}`);
      throw err;
    }
    if (appliedNow) {
      logger.info(`applied ${label}migration: ${m.filename}`);
      result.push({ id: m.id, filename: m.filename });
    } else {
      logger.debug(`${label}migration already applied by a concurrent runner: ${m.filename}`);
    }
  }
  return result;
}
