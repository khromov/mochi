import type { SQL } from 'bun';
import { backoffDelay, type Backoff } from './backoff';
import {
  claimJobs,
  deleteJob,
  dialectOf,
  ensureSchema,
  insertJobs,
  jobNames,
  nextWakeAt,
  releaseRecoveryLease,
  renewLease,
  resolveDatabase,
  retryJob,
  tryRecoveryLease,
  unclaimJob,
  type JobRow,
  type NewJobRow,
} from './db';

export interface Job<T> {
  readonly id: string;
  readonly name: string;
  readonly data: T;
  readonly queue: string;
  /** 1-based; a claim consumed by a crashed instance counts as a spent attempt. */
  readonly attempt: number;
  readonly enqueuedAt: number;
}

export type Processor<T, R> = (job: Job<T>) => R | Promise<R>;

export interface JobRef {
  id: string;
  name: string;
  /** True when a `jobId` collided with a job still outstanding — nothing was added; `name` is the stored job's. */
  deduplicated: boolean;
}

export interface JobOptions {
  /** Lower runs first. Default 0. */
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: Backoff;
  /** Custom id; adding an id already outstanding in this queue is a no-op returning the same ref. */
  jobId?: string;
}

export interface JobRunInfo {
  duration: number;
}

export interface JobFailInfo extends JobRunInfo {
  willRetry: boolean;
}

export interface QueueListeners<T, R> {
  active: (job: Job<T>) => void;
  completed: (job: Job<T>, result: R, info: JobRunInfo) => void;
  failed: (job: Job<T>, error: Error, info: JobFailInfo) => void;
  error: (error: Error) => void;
}

export interface QueueOptions<T, R> {
  /** `'sqlite://…'`, `'postgres://…'`, or a Bun `SQL` instance (shared, never closed by the queue). Omitted → private in-memory sqlite. */
  database?: string | SQL;
  concurrency?: number;
  /** Lease TTL in ms; heartbeat-renewed while a job runs, so it only expires when the instance dies. */
  lockDuration?: number;
  /** How often to look for due jobs beyond local wake signals, ms; <= 0 disables polling. */
  pollInterval?: number;
  /** Lease renewal cadence, ms; defaults to a third of `lockDuration`; <= 0 disables renewal. */
  heartbeatInterval?: number;
  defaultJobOptions?: JobOptions;
  process: Processor<T, R>;
  on?: Partial<QueueListeners<T, R>>;
}

export interface Queue<T = unknown> {
  readonly name: string;
  add(name: string, data: T, opts?: JobOptions): Promise<JobRef>;
  addBulk(jobs: Array<{ name: string; data: T; opts?: JobOptions }>): Promise<JobRef[]>;
  /** Single-flight startup lease shared through the database: true iff this instance should run recovery now. */
  tryRecoveryLease(ttlMs?: number): Promise<boolean>;
  /** Reopen the lease early so another instance may retry — call only when recovery failed. */
  releaseRecoveryLease(): Promise<void>;
  /** Stop claiming, wait for in-flight jobs (up to `timeout` ms), close the database if owned. Idempotent. */
  close(opts?: { timeout?: number }): Promise<void>;
}

export const DEFAULT_LOCK_DURATION_MS = 60_000;
export const DEFAULT_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_RECOVERY_LEASE_MS = 60_000;
export const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;

/** A settle found another instance holding the job — its lease here expired and was reclaimed. */
export class LeaseLostError extends Error {}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function createQueue<T = unknown, R = unknown>(name: string, options: QueueOptions<T, R>): Queue<T> {
  const { sql, owned } = resolveDatabase(options.database);
  const dialect = dialectOf(sql);
  const concurrency = Math.max(options.concurrency ?? 1, 1);
  const lockDuration = Math.max(options.lockDuration ?? DEFAULT_LOCK_DURATION_MS, 1);
  const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL_MS;
  const heartbeatInterval = options.heartbeatInterval ?? Math.max(Math.floor(lockDuration / 3), 25);
  const listeners = options.on ?? {};
  const process = options.process;

  // Re-invoked on every await so a bootstrap that failed (ensureSchema drops it from its memo)
  // is retried by the next add/pump instead of poisoning the queue for the process lifetime.
  let schemaAttempt: Promise<void> | undefined;
  const ready = (): Promise<void> => (schemaAttempt = ensureSchema(sql, dialect));
  // Kicked off eagerly; swallowed here so a pre-pump connection failure isn't an unhandled rejection.
  ready().catch(() => {});

  let closed = false;
  let closePromise: Promise<void> | undefined;
  const running = new Map<string, { token: string }>();
  const inFlight = new Set<Promise<void>>();

  const emitError = (error: Error): void => {
    try {
      listeners.error?.(error);
    } catch {
      // a throwing error listener has nowhere further to go
    }
  };
  const safeEmit = (fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      emitError(toError(err));
    }
  };

  const toJob = (row: JobRow): Job<T> => ({
    id: row.id,
    name: row.name,
    data: JSON.parse(row.data) as T,
    queue: name,
    attempt: Number(row.attempts_made),
    enqueuedAt: Number(row.created_at),
  });

  const rowBackoff = (row: JobRow): Backoff | undefined =>
    row.backoff_type === 'fixed' || row.backoff_type === 'exponential' ? { type: row.backoff_type, delay: Number(row.backoff_delay ?? 0) } : undefined;

  let pumpScheduled = false;
  let pumpRunning = false;
  let pumpPromise: Promise<void> | undefined;
  let rewake = false;
  let emptyTimer: ReturnType<typeof setTimeout> | undefined;

  const wake = (): void => {
    if (closed) {
      return;
    }
    if (pumpRunning) {
      rewake = true;
      return;
    }
    if (!pumpScheduled) {
      pumpScheduled = true;
      queueMicrotask(() => {
        pumpPromise = pump();
      });
    }
  };

  // When a claim comes back short, the next due moment may be closer than the poll tick
  // (a sub-second delay or backoff) — arm a one-shot timer for it.
  const armEmptyTimer = async (): Promise<void> => {
    const at = await nextWakeAt(sql, name);
    if (at === null || closed) {
      return;
    }
    const delay = Math.max(at - Date.now(), 1);
    if (pollInterval > 0 && delay >= pollInterval) {
      return;
    }
    clearTimeout(emptyTimer);
    emptyTimer = setTimeout(() => {
      emptyTimer = undefined;
      wake();
    }, delay);
  };

  const runJob = async (row: JobRow, token: string): Promise<void> => {
    const attempt = Number(row.attempts_made);
    const maxAttempts = Number(row.max_attempts);
    const job = toJob(row);
    if (attempt > maxAttempts) {
      // The final attempt was spent by an instance that crashed mid-run; don't run it again.
      await deleteJob(sql, name, row.id, token);
      safeEmit(() =>
        listeners.failed?.(job, new Error(`job "${row.id}" lease expired on its final attempt — the instance running it crashed or stalled`), { duration: 0, willRetry: false }),
      );
      return;
    }
    safeEmit(() => listeners.active?.(job));
    const start = performance.now();
    let result: R;
    try {
      result = await process(job);
    } catch (err) {
      const duration = performance.now() - start;
      const willRetry = attempt < maxAttempts;
      const settled = willRetry ? await retryJob(sql, name, row.id, token, Date.now() + backoffDelay(rowBackoff(row), attempt)) : await deleteJob(sql, name, row.id, token);
      if (!settled) {
        emitError(new LeaseLostError(`job "${row.id}" failed here but its lease was already reclaimed by another instance`));
        return;
      }
      safeEmit(() => listeners.failed?.(job, toError(err), { duration, willRetry }));
      return;
    }
    const duration = performance.now() - start;
    if (!(await deleteJob(sql, name, row.id, token))) {
      emitError(new LeaseLostError(`job "${row.id}" completed here but its lease was already reclaimed by another instance`));
      return;
    }
    safeEmit(() => listeners.completed?.(job, result, { duration }));
  };

  const startJob = (row: JobRow, token: string): void => {
    running.set(row.id, { token });
    const promise = runJob(row, token)
      .catch((err) => emitError(toError(err)))
      .finally(() => {
        running.delete(row.id);
        inFlight.delete(promise);
        wake();
      });
    inFlight.add(promise);
  };

  const pump = async (): Promise<void> => {
    pumpScheduled = false;
    if (closed) {
      return;
    }
    pumpRunning = true;
    try {
      await ready();
      while (!closed) {
        const capacity = concurrency - running.size;
        if (capacity <= 0) {
          break;
        }
        const token = Bun.randomUUIDv7();
        const rows = await claimJobs(sql, dialect, name, capacity, token, Date.now(), lockDuration);
        if (closed) {
          await Promise.all(rows.map((row) => unclaimJob(sql, name, row.id, token)));
          break;
        }
        // UPDATE … RETURNING does not guarantee the claim ORDER BY, so restore it before dispatch.
        const sorted = [...rows].sort((a, b) => Number(a.priority) - Number(b.priority) || Number(a.run_at) - Number(b.run_at) || (a.id < b.id ? -1 : 1));
        for (const row of sorted) {
          startJob(row, token);
        }
        if (rows.length < capacity) {
          await armEmptyTimer();
          break;
        }
      }
    } catch (err) {
      emitError(toError(err));
    } finally {
      pumpRunning = false;
      if (rewake) {
        rewake = false;
        wake();
      }
    }
  };

  const pollTimer = pollInterval > 0 ? setInterval(wake, pollInterval) : undefined;

  let heartbeatBusy = false;
  let heartbeatPromise: Promise<unknown> | undefined;
  const heartbeatTimer =
    heartbeatInterval > 0
      ? setInterval(() => {
          if (heartbeatBusy || running.size === 0) {
            return;
          }
          heartbeatBusy = true;
          const leaseUntil = Date.now() + lockDuration;
          heartbeatPromise = Promise.all([...running].map(([id, { token }]) => renewLease(sql, name, id, token, leaseUntil)))
            .catch((err) => emitError(toError(err)))
            .finally(() => {
              heartbeatBusy = false;
            });
        }, heartbeatInterval)
      : undefined;

  const toRow = (jobName: string, data: T, opts: JobOptions | undefined, now: number): NewJobRow => {
    const merged = { ...options.defaultJobOptions, ...opts };
    return {
      queue: name,
      id: merged.jobId ?? Bun.randomUUIDv7(),
      name: jobName,
      data: JSON.stringify(data ?? null),
      status: 'pending',
      priority: merged.priority ?? 0,
      run_at: now + Math.max(merged.delay ?? 0, 0),
      attempts_made: 0,
      max_attempts: Math.max(merged.attempts ?? 1, 1),
      backoff_type: merged.backoff?.type ?? null,
      backoff_delay: merged.backoff?.delay ?? null,
      lease_token: null,
      lease_expires_at: null,
      created_at: now,
    };
  };

  const assertOpen = (): void => {
    if (closed) {
      throw new Error(`Queue "${name}" is closed.`);
    }
  };

  return {
    name,
    async add(jobName, data, opts) {
      assertOpen();
      await ready();
      const row = toRow(jobName, data, opts, Date.now());
      const inserted = await insertJobs(sql, [row]);
      if (inserted.size === 0) {
        const names = await jobNames(sql, name, [row.id]);
        return { id: row.id, name: names.get(row.id) ?? row.name, deduplicated: true };
      }
      wake();
      return { id: row.id, name: row.name, deduplicated: false };
    },
    async addBulk(jobs) {
      assertOpen();
      await ready();
      const now = Date.now();
      const rows = jobs.map((j) => toRow(j.name, j.data, j.opts, now));
      const inserted = await insertJobs(sql, rows);
      if (inserted.size > 0) {
        wake();
      }
      const names = await jobNames(
        sql,
        name,
        rows.filter((row) => !inserted.has(row.id)).map((row) => row.id),
      );
      return rows.map((row) =>
        inserted.has(row.id) ? { id: row.id, name: row.name, deduplicated: false } : { id: row.id, name: names.get(row.id) ?? row.name, deduplicated: true },
      );
    },
    async tryRecoveryLease(ttlMs) {
      assertOpen();
      await ready();
      return tryRecoveryLease(sql, name, Date.now(), ttlMs ?? DEFAULT_RECOVERY_LEASE_MS);
    },
    async releaseRecoveryLease() {
      assertOpen();
      await ready();
      await releaseRecoveryLease(sql, name);
    },
    close(opts) {
      closePromise ??= (async () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
        clearTimeout(emptyTimer);
        await schemaAttempt?.catch(() => {});
        // A pump mid-claim must resume and unclaim its rows before the database can close under it.
        await pumpPromise;
        if (inFlight.size > 0) {
          await Promise.race([Promise.all(inFlight), Bun.sleep(opts?.timeout ?? DEFAULT_CLOSE_TIMEOUT_MS)]);
        }
        await heartbeatPromise;
        if (owned) {
          await sql.close();
        }
      })();
      return closePromise;
    },
  };
}
