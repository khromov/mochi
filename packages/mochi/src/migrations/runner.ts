import { toPosixPath } from '../utils';
import { logger } from '../utils/log';
import { dialectFor } from './dialects';
import { loadMigrationFiles } from './loadMigrationFiles';
import type { MochiStorage } from './storage';

const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface RunMigrationsOptions {
  storage: MochiStorage;
  /** Directory of `.sql` files for the storage's database type. */
  dir: string;
  /** Tracking table name (default `'migrations'`). */
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

/**
 * Apply any pending migrations from `opts.dir` to the database behind `opts.storage`. Forward-only: applied
 * migrations must remain an unchanged prefix of the files on disk (verified by hash). Returns the migrations
 * applied during this run; an empty or missing directory returns `[]` without touching the database.
 */
export async function runMigrations(opts: RunMigrationsOptions): Promise<AppliedMigration[]> {
  const table = opts.table ?? 'migrations';
  if (!TABLE_NAME_PATTERN.test(table)) {
    throw new Error(`runMigrations({ table }): "${table}" is not a valid table name.`);
  }
  const files = await loadMigrationFiles(opts.dir);
  if (files.length === 0) {
    return [];
  }

  const label = opts.label ? `${opts.label} ` : '';
  const dialect = dialectFor(opts.storage);
  const sql = dialect.open(opts.storage);
  try {
    const unlock = await dialect.lock(sql);
    try {
      await dialect.ensureTable(sql, table);
      const applied = (await sql.unsafe(`SELECT id, name, hash FROM "${table}" ORDER BY id`)) as AppliedRow[];

      if (applied.length > files.length) {
        throw new Error(
          `The database has ${applied.length} applied ${label}migration(s) but only ${files.length} file(s) exist in ${toPosixPath(opts.dir)} — applied migrations are immutable; restore the missing files.`,
        );
      }
      for (let i = 0; i < applied.length; i++) {
        const row = applied[i]!;
        const file = files[i]!;
        if (file.id !== row.id) {
          throw new Error(
            `Migration mismatch at position ${i + 1} in ${toPosixPath(opts.dir)}: the database has id ${row.id} but the file has id ${file.id} ("${file.filename}") — applied migrations are immutable; don't renumber them.`,
          );
        }
        if (file.hash !== row.hash) {
          throw new Error(`Migration ${file.id} ("${toPosixPath(file.path)}") changed since it was applied — applied migrations are immutable; add a new migration instead.`);
        }
      }

      const pending = files.slice(applied.length);
      if (pending.length === 0) {
        logger.debug(`${label}migrations up to date (${files.length} applied)`);
        return [];
      }

      const result: AppliedMigration[] = [];
      for (const m of pending) {
        try {
          if (m.noTransaction) {
            // Not atomic with the record INSERT: the file must be idempotent so a re-run after a crash succeeds.
            await sql.unsafe(m.contents);
            await sql.unsafe(`INSERT INTO "${table}" (id, name, hash) VALUES ($1, $2, $3)`, [m.id, m.name, m.hash]);
          } else {
            await dialect.begin(sql, async (tx) => {
              await tx.unsafe(m.contents);
              await tx.unsafe(`INSERT INTO "${table}" (id, name, hash) VALUES ($1, $2, $3)`, [m.id, m.name, m.hash]);
            });
          }
        } catch (err) {
          logger.error(`${label}migration failed: ${m.filename}`);
          throw err;
        }
        logger.info(`applied ${label}migration: ${m.filename}`);
        result.push({ id: m.id, filename: m.filename });
      }
      return result;
    } finally {
      await unlock();
    }
  } finally {
    await sql.close();
  }
}
