/**
 * The single isolation boundary around bunqueue: the only module that imports
 * `bunqueue/client`, with no bunqueue type leaking into the public surface, so
 * swapping the backend means rewriting just this file.
 */
import { Queue, Worker, shutdownManager } from 'bunqueue/client';
import type { Job, JobOptions } from 'bunqueue/client';
import { pinGlobal } from './utils/globalState';
import { startupMilestoneReached } from './lifecycle';
import { mochiEvents } from './events';
import { logger } from './utils/log';

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
  defaultJobOptions?: MochiJobOptions;
  /** Forwarded verbatim to bunqueue's `Queue` and `Worker` constructors. */
  bunqueue?: Record<string, unknown>;
}

/** The full config object passed to `Mochi.queue({ process, … })`. */
export interface MochiQueueOptions<T, R = unknown> extends MochiQueueRuntimeOptions {
  process: MochiProcessor<T, R>;
  on?: Partial<MochiQueueListeners<T, R>>;
  /**
   * Runs once at startup, after every queue in `Mochi.serve({ queues })` is
   * mounted, with this queue's handle. The place to add back work
   * your own store still considers unfinished — an in-memory queue loses its
   * jobs on restart, and even a persisted one can't know about rows written
   * before the job was accepted. A throw is logged and emitted as `queue:error`
   * without stopping the server.
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

// Pinned so the registry is shared across any duplicate bundled copy of this
// module (mirrors `mochiEvents` / `requestContext`). The shutdown path
// (`closeAllQueueResources`) must see every resource to drain it, wherever — and
// by whichever bundled copy — it was created.
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
 * Build a queue: a bunqueue `Queue` (producer) and `Worker` (consumer) from one
 * config. Registers the producer handle under `name` (resolved by `getQueue`)
 * and both resources for shutdown draining. Invoked only by `Mochi.serve`, where
 * a queue is declared once with its processor co-located — there is no separate
 * worker concept and no dynamic insertion.
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

  const worker = new Worker<T, R>(name, (job) => process(toMochiJob(job as Job<T>, name)), {
    embedded: true,
    dataPath: options?.dataPath,
    concurrency: options?.concurrency,
    ...options?.bunqueue,
  });

  // bunqueue's `finishedOn`/`processedOn` are unreliable on the public job at
  // event time, so measure duration ourselves from the `active` event. Entries are
  // cleared on completed/failed; a job that goes active but never resolves would
  // leak one, but the map is bounded by in-flight jobs so this is a non-issue.
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
 * Resolve the handle for a queue declared in `Mochi.serve({ queues })`, to add jobs to it.
 * Throws if the name was never declared (a typo, or `getQueue` reached before
 * `Mochi.serve()` mounted its queues) — producing to an unknown queue would
 * otherwise silently drop every job.
 */
export function getQueue<T = unknown>(name: string): MochiQueue<T> {
  const handle = registry.byName.get(name);
  if (!handle) {
    // Three different mistakes, three different answers. Which one it is comes
    // from the recorded startup milestone, not from guessing at registry size:
    // an empty registry means "too early" for one app and "declared nothing"
    // for another, and sending someone hunting for a typo they didn't make is
    // the whole failure this error exists to prevent.
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

/**
 * Run every mounted queue's `recover` callback, once, at startup. Called by
 * `Mochi.serve()` after the whole `queues` map is mounted (not from
 * `createQueue`), so a callback may reach a sibling queue via `getQueue`.
 *
 * A failure is contained: the server is already bound and serving by this
 * point, so a transient store error during recovery must not take the site
 * down with it. It surfaces on the `queue:error` bus and in the log instead.
 */
export async function runQueueRecovery(entries: Array<[string, { recover?: (queue: MochiQueue<never>) => void | Promise<void> }]>): Promise<void> {
  for (const [name, config] of entries) {
    if (!config.recover) {
      continue;
    }
    try {
      await config.recover(getQueue(name) as MochiQueue<never>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[queue] ${name}: recover() failed — ${message}`);
      mochiEvents.emit('queue:error', { queue: name, error: message });
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
