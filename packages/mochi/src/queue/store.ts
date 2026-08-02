import { SqliteQueueStore } from './sqliteStore';
import { PostgresQueueStore } from './postgresStore';
import type { SQL } from 'bun';

/**
 * better-queue's store contract (node-style callbacks), as Mochi implements and accepts it. A "lock" moves tasks out of
 * the queued set: `takeFirstN`/`takeLastN` claim tasks under a fresh lock id, `getLock` reads that claimed set,
 * `releaseLock` discards it, and `putTask` always (re-)files a task as queued — better-queue re-queues a retried task via
 * `putTask` while its old lock is still held, so a put must clear any lock or the retry dies with the released batch.
 */
export interface MochiBetterQueueStore<T = unknown> {
  connect(cb: (err: unknown, length?: number) => void): void;
  getTask(taskId: string, cb: (err: unknown, task?: T) => void): void;
  putTask(taskId: string, task: T, priority: number | undefined, cb: (err?: unknown) => void): void;
  deleteTask(taskId: string, cb: (err?: unknown) => void): void;
  takeFirstN(n: number, cb: (err: unknown, lockId?: string) => void): void;
  takeLastN(n: number, cb: (err: unknown, lockId?: string) => void): void;
  getLock(lockId: string, cb: (err: unknown, tasks?: Record<string, T>) => void): void;
  getRunningTasks(cb: (err: unknown, tasksByLock?: Record<string, Record<string, T>>) => void): void;
  releaseLock(lockId: string, cb: (err?: unknown) => void): void;
  /** Called by `queue.destroy()` on shutdown. */
  close?(cb: (err?: unknown) => void): void;
}

/** Storage backend for a queue: in-memory (the default), a SQLite file, Postgres, or any custom store instance. */
export type MochiQueueStoreOptions =
  { type: 'memory' } | { type: 'sqlite'; path: string; tableName?: string } | { type: 'postgres'; url?: string; sql?: SQL; tableName?: string } | MochiBetterQueueStore;

export function isQueueStoreInstance(value: unknown): value is MochiBetterQueueStore {
  return (
    typeof value === 'object' && value !== null && typeof (value as MochiBetterQueueStore).connect === 'function' && typeof (value as MochiBetterQueueStore).putTask === 'function'
  );
}

/** `undefined` means "use better-queue's bundled in-memory store". */
export function resolveStore(queueName: string, opts: MochiQueueStoreOptions | undefined): MochiBetterQueueStore | undefined {
  if (!opts) {
    return undefined;
  }
  if (isQueueStoreInstance(opts)) {
    return opts;
  }
  switch (opts.type) {
    case 'memory':
      return undefined;
    case 'sqlite':
      return new SqliteQueueStore({ queue: queueName, path: opts.path, tableName: opts.tableName }) as MochiBetterQueueStore;
    case 'postgres':
      return new PostgresQueueStore({ queue: queueName, url: opts.url, sql: opts.sql, tableName: opts.tableName }) as MochiBetterQueueStore;
    default:
      throw new Error(`Unknown queue store type "${(opts as { type: string }).type}" for queue "${queueName}". Use 'memory', 'sqlite', 'postgres', or a store instance.`);
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const DEFAULT_QUEUE_TABLE = 'mochi_queue_tasks';

/** Table names are interpolated into SQL, so anything beyond a plain identifier is rejected up front. */
export function assertTableName(tableName: string): string {
  if (!IDENTIFIER.test(tableName)) {
    throw new Error(`Queue store tableName "${tableName}" must be a plain SQL identifier (letters, digits, underscores).`);
  }
  return tableName;
}
