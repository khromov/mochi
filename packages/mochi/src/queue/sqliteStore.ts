import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { assertTableName, DEFAULT_QUEUE_TABLE } from './store';
import type { MochiBetterQueueStore } from './store';

export interface SqliteQueueStoreOptions {
  queue: string;
  path: string;
  tableName?: string;
}

/**
 * better-queue store on `bun:sqlite`. Rows carry a `queue` column so several queues can share one file, and `lock`
 * carries the claim: `''` means queued, anything else is the lock id of the batch running it. Rows persist while locked,
 * which is what lets better-queue's `autoResume` re-run a batch the previous process died holding.
 */
export class SqliteQueueStore<T = unknown> implements MochiBetterQueueStore<T> {
  private readonly queue: string;
  private readonly path: string;
  private readonly table: string;
  private db: Database | undefined;

  constructor(options: SqliteQueueStoreOptions) {
    this.queue = options.queue;
    this.path = options.path;
    this.table = assertTableName(options.tableName ?? DEFAULT_QUEUE_TABLE);
  }

  connect(cb: (err: unknown, length?: number) => void): void {
    try {
      mkdirSync(path.dirname(this.path), { recursive: true });
      const db = new Database(this.path, { create: true });
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA busy_timeout = 5000;');
      db.exec(
        `CREATE TABLE IF NOT EXISTS ${this.table} (
          queue    TEXT NOT NULL,
          id       TEXT NOT NULL,
          lock     TEXT NOT NULL DEFAULT '',
          priority REAL NOT NULL DEFAULT 0,
          added    INTEGER NOT NULL,
          task     TEXT NOT NULL,
          PRIMARY KEY (queue, id)
        );
        CREATE INDEX IF NOT EXISTS ${this.table}_lock ON ${this.table} (queue, lock);`,
      );
      this.db = db;
      const row = db.query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM ${this.table} WHERE queue = ? AND lock = ''`).get(this.queue);
      cb(null, row?.n ?? 0);
    } catch (err) {
      cb(err);
    }
  }

  getTask(taskId: string, cb: (err: unknown, task?: T) => void): void {
    try {
      const row = this.database.query<{ task: string }, [string, string]>(`SELECT task FROM ${this.table} WHERE queue = ? AND id = ? AND lock = ''`).get(this.queue, taskId);
      cb(null, row ? (JSON.parse(row.task) as T) : undefined);
    } catch (err) {
      cb(err);
    }
  }

  putTask(taskId: string, task: T, priority: number | undefined, cb: (err?: unknown) => void): void {
    try {
      // A put on a locked row is a retry re-queue and moves to the tail (fresh `added`); a put on a queued row is a
      // merge and keeps its position — matching better-queue-memory, where taken tasks left the queue entirely.
      this.database
        .query(
          `INSERT INTO ${this.table} (queue, id, lock, priority, added, task)
           VALUES (?, ?, '', ?, (SELECT COALESCE(MAX(added), 0) + 1 FROM ${this.table}), ?)
           ON CONFLICT (queue, id) DO UPDATE SET
             task = excluded.task,
             priority = excluded.priority,
             added = CASE WHEN ${this.table}.lock != '' THEN excluded.added ELSE ${this.table}.added END,
             lock = ''`,
        )
        .run(this.queue, taskId, priority ?? 0, JSON.stringify(task));
      cb();
    } catch (err) {
      cb(err);
    }
  }

  deleteTask(taskId: string, cb: (err?: unknown) => void): void {
    try {
      this.database.query(`DELETE FROM ${this.table} WHERE queue = ? AND id = ?`).run(this.queue, taskId);
      cb();
    } catch (err) {
      cb(err);
    }
  }

  takeFirstN(n: number, cb: (err: unknown, lockId?: string) => void): void {
    this.take(n, 'ASC', cb);
  }

  takeLastN(n: number, cb: (err: unknown, lockId?: string) => void): void {
    this.take(n, 'DESC', cb);
  }

  getLock(lockId: string, cb: (err: unknown, tasks?: Record<string, T>) => void): void {
    try {
      if (!lockId) {
        cb(null, {});
        return;
      }
      const rows = this.database.query<{ id: string; task: string }, [string, string]>(`SELECT id, task FROM ${this.table} WHERE queue = ? AND lock = ?`).all(this.queue, lockId);
      cb(null, this.toTaskMap(rows));
    } catch (err) {
      cb(err);
    }
  }

  getRunningTasks(cb: (err: unknown, tasksByLock?: Record<string, Record<string, T>>) => void): void {
    try {
      const rows = this.database
        .query<{ id: string; task: string; lock: string }, [string]>(`SELECT id, task, lock FROM ${this.table} WHERE queue = ? AND lock != ''`)
        .all(this.queue);
      const byLock: Record<string, Record<string, T>> = {};
      for (const row of rows) {
        (byLock[row.lock] ??= {})[row.id] = JSON.parse(row.task) as T;
      }
      cb(null, byLock);
    } catch (err) {
      cb(err);
    }
  }

  releaseLock(lockId: string, cb: (err?: unknown) => void): void {
    try {
      if (lockId) {
        this.database.query(`DELETE FROM ${this.table} WHERE queue = ? AND lock = ?`).run(this.queue, lockId);
      }
      cb();
    } catch (err) {
      cb(err);
    }
  }

  close(cb: (err?: unknown) => void): void {
    try {
      this.db?.close();
      this.db = undefined;
      cb();
    } catch (err) {
      cb(err);
    }
  }

  private get database(): Database {
    if (!this.db) {
      throw new Error(`SqliteQueueStore for queue "${this.queue}" is not connected.`);
    }
    return this.db;
  }

  private take(n: number, order: 'ASC' | 'DESC', cb: (err: unknown, lockId?: string) => void): void {
    try {
      const lockId = crypto.randomUUID();
      this.database
        .query(
          `UPDATE ${this.table} SET lock = ? WHERE queue = ? AND id IN (
             SELECT id FROM ${this.table} WHERE queue = ? AND lock = '' ORDER BY priority DESC, added ${order} LIMIT ?
           )`,
        )
        .run(lockId, this.queue, this.queue, n);
      cb(null, lockId);
    } catch (err) {
      cb(err);
    }
  }

  private toTaskMap(rows: Array<{ id: string; task: string }>): Record<string, T> {
    const tasks: Record<string, T> = {};
    for (const row of rows) {
      tasks[row.id] = JSON.parse(row.task) as T;
    }
    return tasks;
  }
}
