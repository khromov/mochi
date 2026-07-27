// The isolation boundary around bunqueue: the only module importing `bunqueue/client`, and the only one whose rewrite a
// backend swap would need.
import { Queue, Worker, shutdownManager } from 'bunqueue/client';
import type { Job, JobOptions } from 'bunqueue/client';
import { pinGlobal } from './utils/globalState';
import { applyFilter } from './extensions';
import { startupMilestoneReached } from './lifecycle';
import { mochiEvents } from './events';
import { logger } from './utils/log';
import { getBuildIdentity } from './tasks/identity';
import type { TaskLeaseStore } from './tasks/lease';

/** Deliberately narrow — data, not bunqueue's ~40 mutation methods — so userland can't reach behind the abstraction. */
export interface MochiJob<T> {
  readonly id: string;
  readonly name: string;
  readonly data: T;
  readonly queue: string;
  /** 1-based (bunqueue's `attemptsMade` is 0-based on the first run). */
  readonly attempt: number;
  readonly enqueuedAt: number;
}

export type MochiProcessor<T, R> = (job: MochiJob<T>) => R | Promise<R>;

/** Lightweight handle returned by `add()` / `addBulk()` — never bunqueue's `Job`. */
export interface MochiJobRef {
  id: string;
  name: string;
}

export interface MochiJobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  jobId?: string;
  /** Forwarded verbatim to bunqueue's `JobOptions`; spread last, so it overrides the fields above. */
  bunqueue?: Record<string, unknown>;
}

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
  /** Omit for in-memory. bunqueue locks the path to the first queue in the process — see `rememberDataPath`. */
  dataPath?: string;
  /** How long a job may run before the queue reclaims it, in ms. Must exceed `process`'s worst-case runtime — see `DEFAULT_LOCK_DURATION_MS`. */
  lockDuration?: number;
  defaultJobOptions?: MochiJobOptions;
  /** Forwarded verbatim to bunqueue's `Queue` and `Worker` constructors. */
  bunqueue?: Record<string, unknown>;
}

/** The full config object passed to `Mochi.queue({ process, … })`. */
export interface MochiQueueOptions<T, R = unknown> extends MochiQueueRuntimeOptions {
  process: MochiProcessor<T, R>;
  on?: Partial<MochiQueueListeners<T, R>>;
  /**
   * Runs once at startup with this queue's handle, after every queue in `Mochi.serve({ queues })` is mounted — the place
   * to add back work your own store still considers unfinished, since an in-memory queue loses its jobs on restart and
   * even a persisted one misses rows written before the job was accepted. A throw is logged and emitted as `queue:error`.
   */
  recover?: (queue: MochiQueue<T>) => void | Promise<void>;
}

/** Handle returned by `Mochi.getQueue(name)` — what you add jobs through. */
export interface MochiQueue<T> {
  readonly name: string;
  add(name: string, data: T, opts?: MochiJobOptions): Promise<MochiJobRef>;
  addBulk(jobs: Array<{ name: string; data: T; opts?: MochiJobOptions }>): Promise<MochiJobRef[]>;
}

interface Closeable {
  /** Drain order on shutdown: workers stop pulling jobs before queues close. */
  kind: 'worker' | 'queue';
  close(): Promise<void>;
}

interface QueueRegistry {
  /** Producer handles, keyed by name; what `getQueue()` resolves. */
  byName: Map<string, MochiQueue<unknown>>;
  /** Every producer/consumer resource, for `closeAllQueueResources` to drain on shutdown. */
  closeables: Set<Closeable>;
  /** First `dataPath` seen; bunqueue ignores later differing paths in the same process. */
  dataPath: string | null | undefined;
}

// Pinned so every duplicate bundled copy of this module shares one registry, since `closeAllQueueResources` must see
// every resource to drain it whichever copy created it.
const registry = pinGlobal<QueueRegistry>('__mochi_queue_registry__', () => ({
  byName: new Map(),
  closeables: new Set(),
  dataPath: undefined,
}));

function rememberDataPath(dataPath: string | undefined): void {
  if (registry.dataPath === undefined) {
    registry.dataPath = dataPath ?? null;
    return;
  }
  const prior = registry.dataPath ?? '(in-memory)';
  const next = dataPath ?? '(in-memory)';
  if (prior !== next) {
    logger.warn(`[queue] dataPath "${next}" ignored — bunqueue locks the embedded store to the first path used this process ("${prior}"). Use one dataPath per process.`);
  }
}

function toMochiJob<T>(job: Job<T>, queueName: string): MochiJob<T> {
  return {
    id: job.id,
    name: job.name,
    data: job.data,
    queue: queueName,
    attempt: job.attemptsMade + 1,
    enqueuedAt: job.timestamp,
  };
}

function toBunJobOptions(opts: MochiJobOptions | undefined): JobOptions | undefined {
  if (!opts) {
    return undefined;
  }
  const { priority, delay, attempts, jobId, bunqueue } = opts;
  return { priority, delay, attempts, jobId, ...bunqueue };
}

/**
 * bunqueue defaults a job's lock to 30s and renews it from the worker heartbeat over TCP only; Mochi's embedded
 * heartbeat calls `jobHeartbeat(id)` without a token, refreshing stall detection but never the lock. The lock therefore
 * always expires on schedule, and a job outliving it is requeued mid-flight, its eventual success rejected with
 * "Invalid or expired lock token", reported as a failure, and retried — double-firing whatever it already did. A single
 * SMTP send has taken 58s in production, so the ceiling is raised to bunqueue's own 30-minute cap.
 *
 * That cap is also why this is the highest useful value: bunqueue's `cleanOrphanedProcessingEntries` drops any entry
 * processing for over 30 minutes whatever the lock says. Lowering it still matters, though a crashed worker's jobs come
 * back through stall detection off the heartbeat, independently of the lock.
 */
export const DEFAULT_LOCK_DURATION_MS = 30 * 60_000;

/**
 * Build a bunqueue `Queue` (producer) and `Worker` (consumer) from one config, registering the producer under `name` for
 * `getQueue` and both resources for shutdown draining. Called only by `Mochi.serve`, where a queue is declared once with
 * its processor co-located.
 */
export function createQueue<T = unknown, R = unknown>(
  name: string,
  process: MochiProcessor<T, R>,
  options?: MochiQueueRuntimeOptions,
  listeners?: Partial<MochiQueueListeners<T, R>>,
): MochiQueue<T> {
  rememberDataPath(options?.dataPath);

  const queue = new Queue<T>(name, {
    embedded: true,
    dataPath: options?.dataPath,
    defaultJobOptions: toBunJobOptions(options?.defaultJobOptions),
    ...options?.bunqueue,
  });

  const producer: MochiQueue<T> = {
    name,
    async add(jobName, data, jobOpts) {
      const job = await queue.add(jobName, data, toBunJobOptions(jobOpts));
      mochiEvents.emit('queue:added', { queue: name, jobId: job.id, jobName: job.name });
      return { id: job.id, name: job.name };
    },
    async addBulk(jobs) {
      const created = await queue.addBulk(jobs.map((j) => ({ name: j.name, data: j.data, opts: toBunJobOptions(j.opts) })));
      for (const job of created) {
        mochiEvents.emit('queue:added', { queue: name, jobId: job.id, jobName: job.name });
      }
      return created.map((job) => ({ id: job.id, name: job.name }));
    },
  };

  const sinks: { [K in keyof MochiQueueListeners<T, R>]: Set<MochiQueueListeners<T, R>[K]> } = {
    active: new Set(),
    completed: new Set(),
    failed: new Set(),
    error: new Set(),
  };
  // Seed caller listeners (from `Mochi.queue({ on })`) BEFORE constructing the
  // worker, which starts draining immediately. Wiring them after would let a job
  // already queued complete in the gap and miss the `completed`/`active` handler.
  if (listeners) {
    for (const key of Object.keys(listeners) as (keyof MochiQueueListeners<T, R>)[]) {
      const listener = listeners[key];
      if (listener) {
        (sinks[key] as unknown as Set<unknown>).add(listener);
      }
    }
  }

  // Filtered per queue after whatever the queue declared for itself, through the first-class option or the raw
  // `bunqueue` passthrough, so the result is applied last rather than spread over. A deployment can then move the lock
  // for every queue at once and still see via `explicit` which ones chose a value themselves.
  const declaredLock = options?.lockDuration ?? (typeof options?.bunqueue?.lockDuration === 'number' ? options.bunqueue.lockDuration : undefined);
  const lockDuration = applyFilter('queue:lockDurationMs', declaredLock ?? DEFAULT_LOCK_DURATION_MS, {
    queue: name,
    explicit: declaredLock !== undefined,
  });

  const worker = new Worker<T, R>(name, (job) => process(toMochiJob(job as Job<T>, name)), {
    embedded: true,
    dataPath: options?.dataPath,
    concurrency: options?.concurrency,
    ...options?.bunqueue,
    lockDuration,
  });

  // bunqueue's `finishedOn`/`processedOn` are unreliable on the public job at event time, so duration is measured here
  // from the `active` event. Entries clear on completed/failed, and the map stays bounded by in-flight jobs.
  const startedAt = new Map<string, number>();
  const durationFor = (jobId: string): number => {
    const start = startedAt.get(jobId);
    startedAt.delete(jobId);
    return start === undefined ? 0 : performance.now() - start;
  };

  worker.on('active', (job) => {
    startedAt.set(job.id, performance.now());
    mochiEvents.emit('queue:active', { queue: name, jobId: job.id, jobName: job.name, attempt: job.attemptsMade + 1 });
    const mj = toMochiJob(job as Job<T>, name);
    for (const l of sinks.active) {
      l(mj);
    }
  });

  worker.on('completed', (job, result) => {
    mochiEvents.emit('queue:completed', { queue: name, jobId: job.id, jobName: job.name, attempt: job.attemptsMade + 1, duration: durationFor(job.id) });
    const mj = toMochiJob(job as Job<T>, name);
    for (const l of sinks.completed) {
      l(mj, result);
    }
  });

  worker.on('failed', (job, error) => {
    mochiEvents.emit('queue:failed', { queue: name, jobId: job.id, jobName: job.name, attempt: job.attemptsMade + 1, duration: durationFor(job.id), error: error.message });
    const mj = toMochiJob(job as Job<T>, name);
    for (const l of sinks.failed) {
      l(mj, error);
    }
  });

  worker.on('error', (error) => {
    mochiEvents.emit('queue:error', { queue: name, error: error.message });
    for (const l of sinks.error) {
      l(error);
    }
  });

  registry.byName.set(name, producer as MochiQueue<unknown>);
  // bunqueue's Queue.close() is synchronous (returns void) — only Worker.close()
  // is async — so the queue's closeable just wraps the sync call.
  registry.closeables.add({ kind: 'queue', close: async () => void queue.close() });
  registry.closeables.add({ kind: 'worker', close: () => worker.close() });
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
 * Failures are contained to the `queue:error` bus and the log: the server is already bound and serving, so a transient
 * store error during recovery must not take the site down.
 *
 * A `recover()` that never settles is reported rather than cut off, since abandoning it would drop the jobs it was about
 * to add — the very failure recovery exists to prevent — while warmup, `mochi:ready`, and `serve()` all wait behind it.
 *
 * Recovery is single-flight across processes when a lease store is supplied. Without one it runs in
 * every process that boots, so an N-instance deploy re-enqueues the same stranded work N times. One
 * lease covers the whole pass rather than one per queue, since recovery is a single startup event.
 *
 * The lease is taken but deliberately never released: its TTL *is* the "recovery already happened"
 * window, so a peer booting inside it skips while a genuine restart later finds it expired. Releasing
 * on completion would invite the next process to redo the work we just did.
 */
export const DEFAULT_RECOVERY_WINDOW_MS = 5 * 60_000;

export interface QueueRecoveryOptions {
  /** Cross-process lease. Omit to run recovery unconditionally in this process. */
  store?: TaskLeaseStore;
  /** How long winning recovery suppresses it in peers, ms. Should exceed a rolling deploy's overlap and stay well under the gap between real restarts. Default 5 minutes. */
  window?: number;
}

type QueueRecoveryEntries = Array<[string, { recover?: (queue: MochiQueue<never>) => void | Promise<void> }]>;

/**
 * Exported so the caller can decide whether to *build* the lease before calling in. `SqlLeaseStore`
 * opens its database in its constructor, so building one for a map with nothing to recover creates a
 * SQLite file the app never reads — on a read-only filesystem, a boot crash rather than mere waste.
 * Both sides asking the same function keeps the two conditions from drifting.
 */
export function hasRecoverableQueues(entries: QueueRecoveryEntries): boolean {
  return entries.some(([, config]) => config.recover !== undefined);
}

export async function runQueueRecovery(entries: QueueRecoveryEntries, recovery: QueueRecoveryOptions = {}): Promise<void> {
  if (!hasRecoverableQueues(entries)) {
    return;
  }
  const recoverable = entries.flatMap(([name, config]) => (config.recover ? [[name, config.recover] as const] : []));

  if (recovery.store) {
    // A store error must not skip recovery: re-running it is the recoverable outcome, skipping it is not.
    let won = true;
    try {
      // A fresh owner per attempt, deliberately NOT `getInstanceId()`. The lease's
      // "we already hold it" clause is renewal for the scheduler; here it would let
      // the same process re-acquire and redo the very work being deduplicated.
      const claim = await recovery.store.tryAcquire({ owner: crypto.randomUUID(), ...getBuildIdentity(), now: Date.now(), ttl: recovery.window ?? DEFAULT_RECOVERY_WINDOW_MS });
      won = claim.acquired;
    } catch (err) {
      logger.warn(`[queue] could not reach the recovery lease store, recovering anyway — ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!won) {
      logger.info(`[queue] these queues were already recovered recently — skipping recovery on this node.`);
      return;
    }
  }

  for (const [name, recover] of recoverable) {
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
      await recover(getQueue(name) as MochiQueue<never>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[queue] ${name}: recover() failed — ${message}`);
      mochiEvents.emit('queue:error', { queue: name, error: message });
    } finally {
      clearTimeout(stallWarning);
    }
  }
}

/**
 * Drain every queue resource — workers first (stop pulling new jobs), then
 * queues. Idempotent and never throws, so it's safe on both the serve shutdown
 * path and the build drain path.
 */
export async function closeAllQueueResources(): Promise<void> {
  const closeables = [...registry.closeables];
  // Workers first so they stop pulling new jobs (and drain in-flight ones)
  // before the queues backing them close out from under them.
  await Promise.allSettled(closeables.filter((c) => c.kind === 'worker').map((c) => c.close()));
  await Promise.allSettled(closeables.filter((c) => c.kind === 'queue').map((c) => c.close()));
  // Embedded mode keeps a process-global manager (open SQLite handle + several
  // un-unref'd background intervals). Closing individual handles doesn't touch
  // it, so without this the SQLite file stays locked (Windows rm -> EBUSY) and
  // the intervals keep the event loop alive (the process never exits). Sync and
  // idempotent, so it's safe on the double-call path.
  shutdownManager();
  // The manager is gone, so the embedded store's first-path lock is released too;
  // reset the remembered path so a fresh queue created afterwards starts clean
  // rather than warning against a stale path. Clear the resources too so a fresh
  // serve in this process (e.g. a test that restarts) can re-mount its queues.
  registry.byName.clear();
  registry.closeables.clear();
  registry.dataPath = undefined;
}
