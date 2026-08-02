// Bridges queuert's SQLite state adapter onto `bun:sqlite`, adapted from queuert's official
// `examples/state-sqlite-bun` provider (MIT).
import type { Database, SQLQueryBindings } from 'bun:sqlite';
import type { AsyncRwLock, SqliteStateProvider } from '@queuert/sqlite';

export type BunSqliteJobsContext = { db: Database };

/**
 * A `SqliteStateProvider` over a `bun:sqlite` handle. `bun:sqlite` is synchronous on one connection, so transactions
 * are serialized behind an async rw-lock: writers get the whole database, readers share it. Statements the app issues
 * on the same `db` inside a `withTransaction` callback join the open transaction — the basis of Mochi's transactional
 * enqueue.
 */
export function createBunSqliteStateProvider({ db, lock }: { db: Database; lock: AsyncRwLock }): SqliteStateProvider<BunSqliteJobsContext> {
  return {
    transactionConcurrency: 'serialized',
    withTransaction: async (fn) => {
      using _held = await lock.acquireWrite();
      db.run('BEGIN');
      try {
        const result = await fn({ db });
        db.run('COMMIT');
        return result;
      } catch (error) {
        if (db.inTransaction) {
          try {
            db.run('ROLLBACK');
          } catch {
            // the transaction is already gone; the original error is what matters
          }
        }
        throw error;
      }
    },
    executeSql: async ({ txCtx, id, sql, params, columnTypes, readOnly }) => {
      const run = (): unknown[] => {
        const database = txCtx?.db ?? db;
        const bindings = (params ?? []) as SQLQueryBindings[];
        // `id` marks a stable statement the adapter reuses — `query()` caches the prepared handle; one-offs
        // (savepoints, migrations) go through `prepare()`/`run()` uncached.
        const prepare = () => (id !== undefined ? database.query<unknown, SQLQueryBindings[]>(sql) : database.prepare<unknown, SQLQueryBindings[]>(sql));
        if (Object.keys(columnTypes).length > 0) {
          return prepare().all(...bindings);
        }
        if (bindings.length > 0) {
          prepare().run(...bindings);
        } else {
          database.run(sql);
        }
        return [];
      };
      if (txCtx) {
        return run();
      }
      using _held = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
      return run();
    },
  };
}
