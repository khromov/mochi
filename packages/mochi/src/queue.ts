// The isolation boundary around better-queue: the only module importing it, and the only one whose rewrite a backend
// swap would need. Storage backends live in `./queue/` (memory / sqlite / postgres / custom instance).
import BetterQueue from 'better-queue';
import { pinGlobal } from './utils/globalState';
import { applyFilter } from './extensions';
import { startupMilestoneReached } from './lifecycle';
import { mochiEvents } from './events';
import { logger } from './utils/log';
import { resolveStore } from './queue/store';
import type { MochiBetterQueueStore, MochiQueueStoreOptions } from './queue/store';

/** Deliberately narrow — data, not better-queue's internals — so userland can't reach behind the abstraction. */
export interface MochiJob<T> {
  readonly id: string;
  readonly data: T;
  readonly queue: string;
  /** 1-based. Tracked by Mochi — better-queue doesn't surface attempt numbers. */
  readonly attempt: number;
  readonly enqueuedAt: number;
}

export type MochiProcessor<T, R> = (job: MochiJob<T>) => R | Promise<R>;

/** Lightweight handle returned by `push()`. */
export interface MochiJobRef {
  id: string;
}

export interface MochiPushOptions {
  /** Explicit job id. Pushing an id that is already queued merges with the queued job (see the `merge` option) instead of enqueueing a duplicate. Default: a random UUID. */
  id?: string;
}

/** Lifecycle listeners; the same map is used for the per-queue `on` option and the `MochiQueueListeners` config. */
export interface MochiQueueListeners<T, R> {
  active: (job: MochiJob<T>) => void;
  completed: (job: MochiJob<T>, result: R) => void;
  /** Terminal only — retries governed by `maxRetries` happen silently before this fires. */
  failed: (job: MochiJob<T>, error: Error) => void;
  error: (error: Error) => void;
}

/**
 * The non-processor settings of a queue — what survives on the inert `MochiQueueConfig.options`. Names follow
 * better-queue's own options; `filter`/`merge`/`priority`/`id` operate on your job data (Mochi unwraps its internal task
 * envelope around them).
 */
export interface MochiQueueRuntimeOptions<T = unknown> {
  /** Jobs processed simultaneously. Default 1. */
  concurrent?: number;
  /** Total attempts a job gets before it fails for good. Default 1 (no retries). */
  maxRetries?: number;
  /** Fixed delay in ms before a failed job is retried. Default 0. */
  retryDelay?: number;
  /** Ms a job may run before it is failed with `task_timeout`. Default: no timeout. Filterable via `queue:maxTimeoutMs`. */
  maxTimeout?: number;
  afterProcessDelay?: number;
  /** Jobs per processing batch. In batch mode each job still runs through `process` individually. */
  batchSize?: number;
  batchDelay?: number;
  batchDelayTimeout?: number;
  /** Newest-first processing. */
  filo?: boolean;
  /** Re-run jobs a previous process died holding (persistent stores only). Default true. */
  autoResume?: boolean;
  failTaskOnProcessException?: boolean;
  cancelIfRunning?: boolean;
  precondition?(cb: (err: unknown, ready: boolean) => void): void;
  preconditionRetryTimeout?: number;
  storeMaxRetries?: number;
  storeRetryTimeout?: number;
  /** Validate/transform a payload before it is queued; pass `undefined`/`null`/`false` to reject the push. */
  filter?(data: T, cb: (err: unknown, data?: T | false | null) => void): void;
  /** Combine a pushed payload with an already-queued job carrying the same id. Default: the new payload replaces the old. */
  merge?(oldData: T, newData: T, cb: (err: unknown, merged?: T) => void): void;
  /** Numeric priority per payload; higher runs first. */
  priority?(data: T, cb: (err: unknown, priority: number) => void): void;
  /** Derive the job id from the payload (the dedupe/merge key). Default: a random UUID per push. */
  id?(data: T): string;
  /** Storage backend. Default: in-memory. */
  store?: MochiQueueStoreOptions;
  /** Forwarded verbatim to the better-queue constructor; spread last, so it overrides the fields above. Overriding `id` or `store` bypasses Mochi's task envelope — expert-only. */
  betterQueue?: Record<string, unknown>;
}

/** The full config object passed to `Mochi.queue({ process, … })`. */
export interface MochiQueueOptions<T, R = unknown> extends MochiQueueRuntimeOptions<T> {
  process: MochiProcessor<T, R>;
  on?: Partial<MochiQueueListeners<T, R>>;
  /**
   * Runs once at startup with this queue's handle, after every queue in `Mochi.serve({ queues })` is mounted — the place
   * to add back work your own store still considers unfinished, since an in-memory queue loses its jobs on restart and
   * even a persisted one misses rows written before the job was accepted. A throw is logged and emitted as `queue:error`.
   */
  recover?: (queue: MochiQueue<T>) => void | Promise<void>;
}

/** Handle returned by `Mochi.getQueue(name)` — what you push jobs through. */
export interface MochiQueue<T> {
  readonly name: string;
  push(data: T, opts?: MochiPushOptions): Promise<MochiJobRef>;
  pause(): void;
  resume(): void;
  getStats(): { total: number; average: number; successRate: number; peak: number };
}

/** What better-queue actually stores and hands the processor: the payload plus the identity Mochi assigned at push. */
interface Envelope<T> {
  id: string;
  data: T;
  enqueuedAt: number;
}

interface QueueRegistry {
  /** Producer handles, keyed by name; what `getQueue()` resolves. */
  byName: Map<string, MochiQueue<unknown>>;
  /** One per queue, for `closeAllQueueResources` to drain on shutdown. */
  closeables: Set<{ close(): Promise<void> }>;
}

// Pinned so every duplicate bundled copy of this module shares one registry, since `closeAllQueueResources` must see
// every resource to drain it whichever copy created it.
const registry = pinGlobal<QueueRegistry>('__mochi_queue_registry__', () => ({
  byName: new Map(),
  closeables: new Set(),
}));

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function toMochiJob<T>(envelope: Envelope<T>, queueName: string, attempt: number): MochiJob<T> {
  return {
    id: envelope.id,
    data: envelope.data,
    queue: queueName,
    attempt,
    enqueuedAt: envelope.enqueuedAt,
  };
}

/**
 * Build a better-queue instance from one config, registering the producer handle under `name` for `getQueue` and the
 * queue for shutdown draining. Called only by `Mochi.serve`, where a queue is declared once with its processor
 * co-located.
 */
export function createQueue<T = unknown, R = unknown>(
  name: string,
  process: MochiProcessor<T, R>,
  options?: MochiQueueRuntimeOptions<T>,
  listeners?: Partial<MochiQueueListeners<T, R>>,
): MochiQueue<T> {
  const sinks: { [K in keyof MochiQueueListeners<T, R>]: Set<MochiQueueListeners<T, R>[K]> } = {
    active: new Set(),
    completed: new Set(),
    failed: new Set(),
    error: new Set(),
  };
  // Seed caller listeners (from `Mochi.queue({ on })`) BEFORE constructing the queue: with a persistent store,
  // `autoResume` starts re-running abandoned jobs the moment the store connects.
  if (listeners) {
    for (const key of Object.keys(listeners) as (keyof MochiQueueListeners<T, R>)[]) {
      const listener = listeners[key];
      if (listener) {
        (sinks[key] as unknown as Set<unknown>).add(listener);
      }
    }
  }

  // Bounded by in-flight and mid-retry jobs; entries clear when a job ends for good.
  const attempts = new Map<string, number>();
  const inflight = new Map<string, { envelope: Envelope<T>; startedAt: number }>();

  const runJob = (envelope: Envelope<T>): Promise<R> => {
    const attempt = (attempts.get(envelope.id) ?? 0) + 1;
    attempts.set(envelope.id, attempt);
    inflight.set(envelope.id, { envelope, startedAt: performance.now() });
    mochiEvents.emit('queue:active', { queue: name, jobId: envelope.id, attempt });
    const job = toMochiJob(envelope, name, attempt);
    for (const l of sinks.active) {
      l(job);
    }
    return Promise.resolve(process(job));
  };

  // better-queue invokes this with `this` bound to its batch worker; in batch mode each envelope settles its own task
  // individually so one failure doesn't fail its batch-mates, with the final `cb` only closing out the batch.
  const processAdapter = function (this: unknown, taskOrBatch: Envelope<T> | Envelope<T>[], cb: (err?: unknown, result?: unknown) => void): void {
    if (!Array.isArray(taskOrBatch)) {
      runJob(taskOrBatch).then(
        (result) => cb(null, result),
        (err) => cb(err),
      );
      return;
    }
    const worker = this as { finishTask(id: number, result: unknown): void; failedTask(id: number, msg: unknown): void };
    void Promise.all(
      taskOrBatch.map((envelope, i) =>
        runJob(envelope).then(
          (result) => worker.finishTask(i, result),
          (err) => worker.failedTask(i, toError(err).message),
        ),
      ),
    ).then(() => cb(null, undefined));
  };

  const userFilter = options?.filter?.bind(options);
  const userMerge = options?.merge?.bind(options);
  const userPriority = options?.priority?.bind(options);

  const bqOptions: BetterQueue.QueueOptions<Envelope<T>, R> = {
    process: processAdapter as BetterQueue.ProcessFunction<Envelope<T>, R>,
    concurrent: options?.concurrent,
    maxRetries: options?.maxRetries,
    retryDelay: options?.retryDelay,
    afterProcessDelay: options?.afterProcessDelay,
    batchSize: options?.batchSize,
    batchDelay: options?.batchDelay,
    batchDelayTimeout: options?.batchDelayTimeout,
    filo: options?.filo,
    autoResume: options?.autoResume ?? true,
    failTaskOnProcessException: options?.failTaskOnProcessException,
    cancelIfRunning: options?.cancelIfRunning,
    precondition: options?.precondition?.bind(options),
    preconditionRetryTimeout: options?.preconditionRetryTimeout,
    storeMaxRetries: options?.storeMaxRetries,
    storeRetryTimeout: options?.storeRetryTimeout,
    // The envelope key is the task id — this is what makes `push()` able to resolve with a stable job id.
    id: 'id',
    filter: userFilter
      ? (envelope, cb) =>
          userFilter(envelope.data, (err, data) => {
            if (err || data === undefined || data === null || data === false) {
              cb(err ?? null, undefined as never);
              return;
            }
            cb(null, { ...envelope, data });
          })
      : undefined,
    // Merging keeps the OLD envelope's id and enqueuedAt: the queued job absorbs the new payload, it doesn't restart.
    merge: userMerge
      ? (oldEnvelope, newEnvelope, cb) =>
          userMerge(oldEnvelope.data, newEnvelope.data, (err, merged) =>
            err || merged === undefined ? cb(err ?? null, undefined as never) : cb(null, { ...oldEnvelope, data: merged }),
          )
      : undefined,
    priority: userPriority ? (envelope, cb) => userPriority(envelope.data, cb as (err: unknown, priority: number) => void) : undefined,
    store: (resolveStore(name, options?.store) as BetterQueue.Store<Envelope<T>> | undefined) ?? 'memory',
    ...options?.betterQueue,
  };

  // Filtered per queue after whatever the queue declared for itself, through the first-class option or the raw
  // `betterQueue` passthrough, so the result is applied last rather than spread over. A deployment can then move the
  // timeout for every queue at once and still see via `explicit` which ones chose a value themselves.
  const declaredTimeout = options?.maxTimeout ?? (typeof options?.betterQueue?.maxTimeout === 'number' ? options.betterQueue.maxTimeout : undefined);
  bqOptions.maxTimeout = applyFilter('queue:maxTimeoutMs', declaredTimeout ?? Infinity, {
    queue: name,
    explicit: declaredTimeout !== undefined,
  });

  const bq = new BetterQueue<Envelope<T>, R>(bqOptions);

  bq.on('task_finish', (taskId: string, result: R) => {
    const entry = inflight.get(taskId);
    inflight.delete(taskId);
    const attempt = attempts.get(taskId) ?? 1;
    attempts.delete(taskId);
    mochiEvents.emit('queue:completed', { queue: name, jobId: taskId, attempt, duration: entry ? performance.now() - entry.startedAt : 0 });
    if (entry) {
      const job = toMochiJob(entry.envelope, name, attempt);
      for (const l of sinks.completed) {
        l(job, result);
      }
    }
  });

  bq.on('task_failed', (taskId: string, message: unknown) => {
    const entry = inflight.get(taskId);
    inflight.delete(taskId);
    const attempt = attempts.get(taskId) ?? 1;
    attempts.delete(taskId);
    const error = toError(message);
    mochiEvents.emit('queue:failed', { queue: name, jobId: taskId, attempt, duration: entry ? performance.now() - entry.startedAt : 0, error: error.message });
    // A job can fail without ever starting (e.g. a store write error) — then there's no envelope to hand listeners.
    if (entry) {
      const job = toMochiJob(entry.envelope, name, attempt);
      for (const l of sinks.failed) {
        l(job, error);
      }
    }
  });

  bq.on('error', (err: unknown) => {
    const error = toError(err);
    mochiEvents.emit('queue:error', { queue: name, error: error.message });
    for (const l of sinks.error) {
      l(error);
    }
  });

  const deriveId = options?.id?.bind(options);
  const producer: MochiQueue<T> = {
    name,
    push(data, opts) {
      const id = opts?.id ?? deriveId?.(data) ?? crypto.randomUUID();
      const envelope: Envelope<T> = { id, data, enqueuedAt: Date.now() };
      return new Promise<MochiJobRef>((resolve, reject) => {
        const ticket = bq.push(envelope);
        const settle = (fn: () => void) => {
          ticket.removeListener('queued', onQueued);
          ticket.removeListener('failed', onFailed);
          fn();
        };
        const onQueued = () =>
          settle(() => {
            mochiEvents.emit('queue:added', { queue: name, jobId: id });
            resolve({ id });
          });
        const onFailed = (message: unknown) => settle(() => reject(toError(message)));
        ticket.on('queued', onQueued);
        ticket.on('failed', onFailed);
      });
    },
    pause: () => bq.pause(),
    resume: () => bq.resume(),
    getStats: () => bq.getStats(),
  };

  registry.byName.set(name, producer as MochiQueue<unknown>);
  registry.closeables.add({
    // `destroy` stops processing and closes the store without deleting persisted tasks — a sqlite/postgres queue picks
    // its backlog back up on the next boot via `autoResume`.
    close: () => new Promise<void>((resolve) => bq.destroy(resolve)),
  });
  return producer;
}

/**
 * Resolve the handle for a queue declared in `Mochi.serve({ queues })`, to push jobs to it. Throws for an undeclared name
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
 * TODO: single-flight recovery across processes. Recovery currently runs in
 * every process that boots, so an N-instance deploy (or a rolling restart where
 * old and new overlap) has N processes re-enqueueing the same work from the same
 * store — N copies of every stranded job. Today only single-instance apps are
 * safe, which the single-process note in the queues docs already implies but
 * doesn't state.
 *
 * The intended shape, in order:
 *   1. Sleep a random jitter before touching the store — default 0–5000ms, with
 *      the bounds filterable per queue (`queue:recoveryJitterMinMs` /
 *      `queue:recoveryJitterMaxMs`, alongside the stall-warning filter below).
 *      Note this delays `serve()` resolving, so the default upper bound is a
 *      boot-latency tradeoff, and 0/0 must remain a clean opt-out.
 *   2. Try to acquire a lease named for the queue through a cross-process
 *      persistence layer that DOES NOT EXIST YET — it has to outlive any single
 *      process, so `pinGlobal` doesn't qualify (the postgres store's table could).
 *      Designing that store is the actual blocking work here.
 *   3. Run `recover()` only if the lease was won; otherwise skip it and say so
 *      at debug level. The lease needs a TTL so a process that dies mid-recovery
 *      doesn't lock the queue out of recovery forever — same reasoning as the
 *      in-flight marker lease in `cache.ts`.
 *
 * The jitter is NOT the mechanism and must not ship on its own: it only narrows
 * the window in which two processes collide, and a narrower race is harder to
 * reproduce while being just as wrong. The lease in step 2 is what makes this
 * correct; step 1 exists only to keep N processes from stampeding it at once.
 */
export async function runQueueRecovery(entries: Array<[string, { recover?: (queue: MochiQueue<never>) => void | Promise<void> }]>): Promise<void> {
  for (const [name, config] of entries) {
    if (!config.recover) {
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
    } finally {
      clearTimeout(stallWarning);
    }
  }
}

/**
 * Drain every queue on shutdown: `destroy` stops processing and closes each store (persisted tasks stay put for the
 * next boot's `autoResume`). Idempotent and never throws, so it's safe on both the serve shutdown path and the build
 * drain path.
 */
export async function closeAllQueueResources(): Promise<void> {
  const closeables = [...registry.closeables];
  await Promise.allSettled(closeables.map((c) => c.close()));
  // Cleared so a fresh serve in this process (e.g. a test that restarts) can re-mount its queues.
  registry.byName.clear();
  registry.closeables.clear();
}

export type { MochiBetterQueueStore, MochiQueueStoreOptions };
