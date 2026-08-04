// The isolation boundary around @mochi-framework/queue: the only module importing the engine, and the only one whose
// rewrite a backend swap would need.
import { createQueue as createEngineQueue, DEFAULT_LOCK_DURATION_MS } from '@mochi-framework/queue';
import type { Backoff, Job, JobOptions, JobRef, Processor, Queue as EngineQueue } from '@mochi-framework/queue';
import { SQL } from 'bun';
import { pinGlobal } from './utils/globalState';
import { applyFilter } from './extensions';
import { startupMilestoneReached } from './lifecycle';
import { mochiEvents } from './events';
import { logger } from './utils/log';

export type MochiJob<T> = Job<T>;
export type MochiProcessor<T, R> = Processor<T, R>;
export type MochiJobRef = JobRef;
export type MochiJobBackoff = Backoff;
export type MochiJobOptions = JobOptions;

export { DEFAULT_LOCK_DURATION_MS };

/** Lifecycle listeners; the same map is used for the per-queue `on` option and the `MochiQueueListeners` config. */
export interface MochiQueueListeners<T, R> {
  active: (job: MochiJob<T>) => void;
  completed: (job: MochiJob<T>, result: R) => void;
  failed: (job: MochiJob<T>, error: Error) => void;
  error: (error: Error) => void;
}

/** The non-processor settings of a queue — what survives on the inert `MochiQueueConfig.options`. */
export interface MochiQueueRuntimeOptions {
  concurrency?: number;
  /** `'sqlite://path'`, `'postgres://…'`, or a Bun `SQL` instance to share with app code. Omit for in-memory. */
  database?: string | SQL;
  /** Lease TTL in ms; heartbeat-renewed while a job runs, so it only expires when the instance dies. */
  lockDuration?: number;
  /** How long this instance's `recover()` win blocks siblings from re-running recovery, in ms. */
  recoveryLeaseMs?: number;
  defaultJobOptions?: MochiJobOptions;
}

/** The full config object passed to `Mochi.queue({ process, … })`. */
export interface MochiQueueOptions<T, R = unknown> extends MochiQueueRuntimeOptions {
  process: MochiProcessor<T, R>;
  on?: Partial<MochiQueueListeners<T, R>>;
  /**
   * Runs once at startup with this queue's handle, after every queue in `Mochi.serve({ queues })` is mounted — the place
   * to add back work your own store still considers unfinished, since an in-memory queue loses its jobs on restart and
   * even a persisted one misses rows written before the job was accepted. Single-flight across instances sharing a
   * `database`: a recovery lease in the store lets exactly one booting instance run it per TTL window. A throw is logged
   * and emitted as `queue:error`.
   */
  recover?: (queue: MochiQueue<T>) => void | Promise<void>;
}

/** Handle returned by `Mochi.getQueue(name)` — what you add jobs through. */
export interface MochiQueue<T> {
  readonly name: string;
  add(name: string, data: T, opts?: MochiJobOptions): Promise<MochiJobRef>;
  addBulk(jobs: Array<{ name: string; data: T; opts?: MochiJobOptions }>): Promise<MochiJobRef[]>;
}

interface QueueRegistry {
  /** Producer handles, keyed by name; what `getQueue()` resolves. */
  byName: Map<string, MochiQueue<unknown>>;
  /** Engine handles, for recovery leases and shutdown draining. */
  engines: Map<string, EngineQueue<never>>;
  /** SQL instances this module created (keyed by database string, '' = the shared in-memory default) — ours to close. */
  ownedSql: Map<string, SQL>;
}

// Pinned so every duplicate bundled copy of this module shares one registry, since `closeAllQueueResources` must see
// every resource to drain it whichever copy created it.
const registry = pinGlobal<QueueRegistry>('__mochi_queue_registry__', () => ({
  byName: new Map(),
  engines: new Map(),
  ownedSql: new Map(),
}));

// One shared instance per distinct database string (all default queues share one in-memory store, mirroring the old
// embedded backend); a user-passed SQL instance goes straight through and is never owned or closed here.
function resolveDatabase(database: string | SQL | undefined): SQL {
  if (database !== undefined && typeof database !== 'string') {
    return database;
  }
  const key = database ?? '';
  let sql = registry.ownedSql.get(key);
  if (!sql) {
    sql = new SQL(key === '' ? 'sqlite://:memory:' : key);
    registry.ownedSql.set(key, sql);
  }
  return sql;
}

/**
 * Build a live queue from one config, registering the producer under `name` for `getQueue` and the engine for shutdown
 * draining. Called only by `Mochi.serve`, where a queue is declared once with its processor co-located.
 */
export function createQueue<T = unknown, R = unknown>(
  name: string,
  process: MochiProcessor<T, R>,
  options?: MochiQueueRuntimeOptions,
  listeners?: Partial<MochiQueueListeners<T, R>>,
): MochiQueue<T> {
  // A deployment can move the lease for every queue at once and still see via `explicit` which ones chose a value.
  const lockDuration = applyFilter('queue:lockDurationMs', options?.lockDuration ?? DEFAULT_LOCK_DURATION_MS, {
    queue: name,
    explicit: options?.lockDuration !== undefined,
  });

  const engine = createEngineQueue<T, R>(name, {
    database: resolveDatabase(options?.database),
    concurrency: options?.concurrency,
    lockDuration,
    defaultJobOptions: options?.defaultJobOptions,
    process,
    on: {
      active: (job) => {
        mochiEvents.emit('queue:active', { queue: name, jobId: job.id, jobName: job.name, attempt: job.attempt });
        listeners?.active?.(job);
      },
      completed: (job, result, info) => {
        mochiEvents.emit('queue:completed', { queue: name, jobId: job.id, jobName: job.name, attempt: job.attempt, duration: info.duration });
        listeners?.completed?.(job, result);
      },
      failed: (job, error, info) => {
        mochiEvents.emit('queue:failed', { queue: name, jobId: job.id, jobName: job.name, attempt: job.attempt, duration: info.duration, error: error.message });
        listeners?.failed?.(job, error);
      },
      error: (error) => {
        mochiEvents.emit('queue:error', { queue: name, error: error.message });
        listeners?.error?.(error);
      },
    },
  });

  const producer: MochiQueue<T> = {
    name,
    async add(jobName, data, jobOpts) {
      const ref = await engine.add(jobName, data, jobOpts);
      mochiEvents.emit('queue:added', { queue: name, jobId: ref.id, jobName: ref.name });
      return ref;
    },
    async addBulk(jobs) {
      const refs = await engine.addBulk(jobs);
      for (const ref of refs) {
        mochiEvents.emit('queue:added', { queue: name, jobId: ref.id, jobName: ref.name });
      }
      return refs;
    },
  };

  registry.byName.set(name, producer as MochiQueue<unknown>);
  registry.engines.set(name, engine as EngineQueue<never>);
  return producer;
}

/**
 * Resolve the handle for a queue declared in `Mochi.serve({ queues })`, to add jobs to it. Throws for an undeclared name
 * — a typo, or a call before `Mochi.serve()` mounted its queues — since producing to an unknown queue would silently drop every job.
 */
export function getQueue<T = unknown>(name: string): MochiQueue<T> {
  const handle = registry.byName.get(name);
  if (!handle) {
    // Three different mistakes, three different answers, told apart by the recorded startup milestone: registry size
    // can't distinguish them, since an empty registry means "too early" for one app and "declared nothing" for another.
    if (!startupMilestoneReached('mochi:queuesMounted')) {
      throw new Error(
        `Mochi.getQueue("${name}"): queues are not mounted yet. Mochi.serve({ queues }) mounts them after the "mochi:init" hook and after the server binds, so call getQueue() somewhere that runs later: a queue's recover() callback, the "mochi:ready" hook, or any request handler.`,
      );
    }
    if (registry.byName.size === 0) {
      throw new Error(`Mochi.getQueue("${name}"): no queues were declared. Add it to Mochi.serve({ queues: { "${name}": Mochi.queue(...) } }) before adding jobs to it.`);
    }
    throw new Error(
      `Mochi.getQueue("${name}"): no such queue. Declare it via Mochi.serve({ queues: { "${name}": Mochi.queue(...) } }) before adding jobs to it. Mounted queues: ${[...registry.byName.keys()].join(', ')}.`,
    );
  }
  return handle as MochiQueue<T>;
}

export const DEFAULT_RECOVERY_STALL_WARNING_MS = 30_000;

/**
 * Run every mounted queue's `recover` callback once at startup. `Mochi.serve()` calls it after the whole `queues` map is
 * mounted, so a callback may reach a sibling queue via `getQueue`.
 *
 * Single-flight across instances: a recovery lease in the queue's own store gates the callback, so N instances booting
 * against one shared `database` re-enqueue stranded work once, not N times. A win holds until the lease TTL (a rolling
 * restart's second instance skips recovery the first just ran); a failed recovery releases the lease so the next boot
 * retries immediately. With the in-memory default every process has a private store, so each trivially wins its own lease.
 *
 * Failures are contained to the `queue:error` bus and the log: the server is already bound and serving, so a transient
 * store error during recovery must not take the site down.
 *
 * A `recover()` that never settles is reported rather than cut off, since abandoning it would drop the jobs it was about
 * to add — the very failure recovery exists to prevent — while warmup, `mochi:ready`, and `serve()` all wait behind it.
 */
export async function runQueueRecovery(
  entries: Array<[string, { options?: MochiQueueRuntimeOptions; recover?: (queue: MochiQueue<never>) => void | Promise<void> }]>,
): Promise<void> {
  for (const [name, config] of entries) {
    if (!config.recover) {
      continue;
    }
    const engine = registry.engines.get(name);
    try {
      if (engine && !(await engine.tryRecoveryLease(config.options?.recoveryLeaseMs))) {
        logger.debug(`[queue] ${name}: recovery skipped — another instance holds the recovery lease.`);
        continue;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[queue] ${name}: recovery lease check failed — ${message}`);
      mochiEvents.emit('queue:error', { queue: name, error: message });
      continue;
    }
    // Resolved per queue, not once for the run: a queue whose recovery reads a
    // slow store legitimately needs a longer threshold than its siblings.
    // A non-positive value opts that queue out of the warning entirely.
    const stallMs = applyFilter('queue:recoveryStallWarningMs', DEFAULT_RECOVERY_STALL_WARNING_MS, { queue: name });
    const stallWarning =
      stallMs > 0
        ? setTimeout(() => {
            logger.warn(`[queue] ${name}: recover() is still running after ${stallMs / 1000}s — Mochi.serve() cannot resolve until it settles.`);
          }, stallMs)
        : undefined;
    // Never hold the process open on the warning alone.
    stallWarning?.unref?.();
    try {
      await config.recover(getQueue(name) as MochiQueue<never>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[queue] ${name}: recover() failed — ${message}`);
      mochiEvents.emit('queue:error', { queue: name, error: message });
      // Reopen the lease so the next boot retries immediately instead of waiting out the TTL.
      await engine?.releaseRecoveryLease().catch(() => {});
    } finally {
      clearTimeout(stallWarning);
    }
  }
}

/**
 * Drain every queue resource — each engine stops claiming and waits for its in-flight jobs — then close the SQL
 * instances this module created. Idempotent and never throws, so it's safe on both the serve shutdown path and the
 * build drain path.
 */
export async function closeAllQueueResources(): Promise<void> {
  await Promise.allSettled([...registry.engines.values()].map((engine) => engine.close()));
  await Promise.allSettled([...registry.ownedSql.values()].map((sql) => sql.close()));
  registry.byName.clear();
  registry.engines.clear();
  registry.ownedSql.clear();
}
