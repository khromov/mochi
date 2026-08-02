import { SQL } from 'bun';
import { assertTableName, DEFAULT_QUEUE_TABLE } from './store';
import type { MochiBetterQueueStore } from './store';

export interface PostgresQueueStoreOptions {
  queue: string;
  /** Connection string; omitted, `Bun.SQL` falls back to `DATABASE_URL`/`POSTGRES_URL`. Ignored when `sql` is given. */
  url?: string;
  /** An existing `Bun.SQL` pool to share; the store then never closes it. */
  sql?: SQL;
  tableName?: string;
}

/**
 * better-queue store on `Bun.sql` (Postgres). Same schema and lock semantics as `SqliteQueueStore`; the take subselect
 * adds `FOR UPDATE SKIP LOCKED` so two connections claiming concurrently never lock the same rows.
 */
export class PostgresQueueStore<T = unknown> implements MochiBetterQueueStore<T> {
  private readonly queue: string;
  private readonly table: string;
  private readonly sql: SQL;
  private readonly ownsSql: boolean;

  constructor(options: PostgresQueueStoreOptions) {
    this.queue = options.queue;
    this.table = assertTableName(options.tableName ?? DEFAULT_QUEUE_TABLE);
    this.sql = options.sql ?? (options.url ? new SQL(options.url) : new SQL());
    this.ownsSql = !options.sql;
  }

  connect(cb: (err: unknown, length?: number) => void): void {
    this.setup().then(
      (length) => cb(null, length),
      (err) => cb(err),
    );
  }

  getTask(taskId: string, cb: (err: unknown, task?: T) => void): void {
    this.bridge(cb, async () => {
      const rows = await this.sql`SELECT task FROM ${this.sql(this.table)} WHERE queue = ${this.queue} AND id = ${taskId} AND lock = ''`;
      return rows.length ? (JSON.parse(rows[0].task as string) as T) : undefined;
    });
  }

  putTask(taskId: string, task: T, priority: number | undefined, cb: (err?: unknown) => void): void {
    this.bridge(cb, async () => {
      // A put on a locked row is a retry re-queue and moves to the tail (fresh `added`); a put on a queued row is a
      // merge and keeps its position — matching better-queue-memory, where taken tasks left the queue entirely.
      await this.sql`
        INSERT INTO ${this.sql(this.table)} (queue, id, lock, priority, task)
        VALUES (${this.queue}, ${taskId}, '', ${priority ?? 0}, ${JSON.stringify(task)})
        ON CONFLICT (queue, id) DO UPDATE SET
          task = excluded.task,
          priority = excluded.priority,
          added = CASE WHEN ${this.sql(this.table)}.lock != '' THEN excluded.added ELSE ${this.sql(this.table)}.added END,
          lock = ''`;
    });
  }

  deleteTask(taskId: string, cb: (err?: unknown) => void): void {
    this.bridge(cb, async () => {
      await this.sql`DELETE FROM ${this.sql(this.table)} WHERE queue = ${this.queue} AND id = ${taskId}`;
    });
  }

  takeFirstN(n: number, cb: (err: unknown, lockId?: string) => void): void {
    this.take(n, false, cb);
  }

  takeLastN(n: number, cb: (err: unknown, lockId?: string) => void): void {
    this.take(n, true, cb);
  }

  getLock(lockId: string, cb: (err: unknown, tasks?: Record<string, T>) => void): void {
    this.bridge(cb, async () => {
      if (!lockId) {
        return {};
      }
      const rows = await this.sql`SELECT id, task FROM ${this.sql(this.table)} WHERE queue = ${this.queue} AND lock = ${lockId}`;
      const tasks: Record<string, T> = {};
      for (const row of rows) {
        tasks[row.id as string] = JSON.parse(row.task as string) as T;
      }
      return tasks;
    });
  }

  getRunningTasks(cb: (err: unknown, tasksByLock?: Record<string, Record<string, T>>) => void): void {
    this.bridge(cb, async () => {
      const rows = await this.sql`SELECT id, task, lock FROM ${this.sql(this.table)} WHERE queue = ${this.queue} AND lock != ''`;
      const byLock: Record<string, Record<string, T>> = {};
      for (const row of rows) {
        (byLock[row.lock as string] ??= {})[row.id as string] = JSON.parse(row.task as string) as T;
      }
      return byLock;
    });
  }

  releaseLock(lockId: string, cb: (err?: unknown) => void): void {
    this.bridge(cb, async () => {
      if (lockId) {
        await this.sql`DELETE FROM ${this.sql(this.table)} WHERE queue = ${this.queue} AND lock = ${lockId}`;
      }
    });
  }

  close(cb: (err?: unknown) => void): void {
    if (!this.ownsSql) {
      cb();
      return;
    }
    this.sql.close().then(
      () => cb(),
      (err) => cb(err),
    );
  }

  private async setup(): Promise<number> {
    try {
      await this.sql`
        CREATE TABLE IF NOT EXISTS ${this.sql(this.table)} (
          queue    TEXT NOT NULL,
          id       TEXT NOT NULL,
          lock     TEXT NOT NULL DEFAULT '',
          priority DOUBLE PRECISION NOT NULL DEFAULT 0,
          added    BIGSERIAL,
          task     TEXT NOT NULL,
          PRIMARY KEY (queue, id)
        )`;
      await this.sql`CREATE INDEX IF NOT EXISTS ${this.sql(`${this.table}_lock`)} ON ${this.sql(this.table)} (queue, lock)`;
    } catch (err) {
      // IF NOT EXISTS still races on the implicit sequence when two queues connect at once; if the table is usable, the loser's error is noise.
      await this.sql`SELECT 1 FROM ${this.sql(this.table)} LIMIT 1`.catch(() => {
        throw err;
      });
    }
    const rows = await this.sql`SELECT COUNT(*) AS n FROM ${this.sql(this.table)} WHERE queue = ${this.queue} AND lock = ''`;
    return Number(rows[0]?.n ?? 0);
  }

  private take(n: number, newestFirst: boolean, cb: (err: unknown, lockId?: string) => void): void {
    this.bridge(cb, async () => {
      const lockId = crypto.randomUUID();
      const claim = newestFirst
        ? this.sql`
        UPDATE ${this.sql(this.table)} SET lock = ${lockId} WHERE (queue, id) IN (
          SELECT queue, id FROM ${this.sql(this.table)} WHERE queue = ${this.queue} AND lock = ''
          ORDER BY priority DESC, added DESC LIMIT ${n} FOR UPDATE SKIP LOCKED
        )`
        : this.sql`
        UPDATE ${this.sql(this.table)} SET lock = ${lockId} WHERE (queue, id) IN (
          SELECT queue, id FROM ${this.sql(this.table)} WHERE queue = ${this.queue} AND lock = ''
          ORDER BY priority DESC, added ASC LIMIT ${n} FOR UPDATE SKIP LOCKED
        )`;
      await claim;
      return lockId;
    });
  }

  private bridge<V>(cb: (err: unknown, value?: V) => void, op: () => Promise<V | undefined>): void {
    op().then(
      (value) => cb(null, value),
      (err) => cb(err),
    );
  }
}
