/**
 * Background job queues for Mochi, backed by bunqueue's embedded mode.
 *
 * This is the single isolation boundary around bunqueue: it is the only module
 * in the framework that imports `bunqueue/client`, and no bunqueue type ever
 * leaks into the public surface. Swapping the backend means rewriting this file
 * and nothing else (`grep -rl "bunqueue" packages/mochi/src` returns just this).
 *
 * Unlike `Mochi.page/api/ws/sse/file` — which return inert config objects that
 * `Mochi.serve()` mounts — `Mochi.queue()` and `Mochi.worker()` return *live
 * handles* created at module top-level. A queue is a producer you call `.add()`
 * on from anywhere (e.g. a page action); a worker is a consumer that starts
 * processing immediately. This mirrors bunqueue's embedded `new Queue` +
 * `new Worker`, which share in-process state.
 */
import { Queue, Worker } from 'bunqueue/client';
import type { Job, JobOptions } from 'bunqueue/client';
import { pinGlobal } from './globalState';
import { mochiEvents } from './events';
import { logger } from './log';

/**
 * Read-only view of a job handed to a worker processor and to worker event
 * listeners. Deliberately narrow — it carries data, not bunqueue's ~40 mutation
 * methods — so userland can't reach behind the abstraction.
 */
export interface MochiJob<T> {
  readonly id: string;
  readonly name: string;
  readonly data: T;
  /** Name of the queue this job belongs to. */
  readonly queue: string;
  /** 1-based attempt number (1 on the first run, 2 on the first retry, …). */
  readonly attempt: number;
  /** Epoch ms when the job was enqueued. */
  readonly enqueuedAt: number;
}

export type MochiProcessor<T, R> = (job: MochiJob<T>) => R | Promise<R>;

/** Lightweight handle returned by `add()` / `addBulk()` — never bunqueue's `Job`. */
export interface MochiJobRef {
  id: string;
  name: string;
}

export interface MochiJobOptions {
  /** Higher runs sooner. */
  priority?: number;
  /** Delay in ms before the job becomes available. */
  delay?: number;
  /** Max attempts before the job is considered failed. */
  attempts?: number;
  /** Custom id, for idempotency / deduplication. */
  jobId?: string;
  /**
   * Escape hatch: forwarded verbatim to bunqueue's `JobOptions` (backoff,
   * repeat, deduplication, …). Spread last, so it overrides the fields above.
   */
  bunqueue?: Record<string, unknown>;
}

export interface MochiQueueOptions {
  /**
   * SQLite file for embedded persistence. Omit for an in-memory queue (jobs do
   * not survive a restart). bunqueue locks the path to the first queue/worker
   * constructed in the process — see the conflict warning below.
   */
  dataPath?: string;
  defaultJobOptions?: MochiJobOptions;
  /** Forwarded verbatim to bunqueue's `QueueOptions`. */
  bunqueue?: Record<string, unknown>;
}

export interface MochiWorkerOptions {
  /** How many jobs to process at once. Default: bunqueue's default (1). */
  concurrency?: number;
  /** SQLite file for embedded persistence. See `MochiQueueOptions.dataPath`. */
  dataPath?: string;
  /** Forwarded verbatim to bunqueue's `WorkerOptions` (limiter, lockDuration, …). */
  bunqueue?: Record<string, unknown>;
}

export interface MochiQueue<T> {
  readonly name: string;
  add(name: string, data: T, opts?: MochiJobOptions): Promise<MochiJobRef>;
  addBulk(jobs: Array<{ name: string; data: T; opts?: MochiJobOptions }>): Promise<MochiJobRef[]>;
  close(): Promise<void>;
}

export interface MochiWorkerEventMap<T, R> {
  active: (job: MochiJob<T>) => void;
  completed: (job: MochiJob<T>, result: R) => void;
  failed: (job: MochiJob<T>, error: Error) => void;
  error: (error: Error) => void;
}

export interface MochiWorker<T, R> {
  readonly name: string;
  on<K extends keyof MochiWorkerEventMap<T, R>>(event: K, listener: MochiWorkerEventMap<T, R>[K]): this;
  close(): Promise<void>;
}

interface Closeable {
  close(): Promise<void>;
}

interface QueueRegistry {
  queues: Set<Closeable>;
  workers: Set<Closeable>;
  queuesByName: Map<string, Closeable>;
  workersByName: Map<string, Closeable>;
  /** Worker names we've already warned about re-registering, so dev HMR doesn't spam. */
  warnedReregister: Set<string>;
  /** First `dataPath` seen; bunqueue ignores later differing paths in the same process. */
  dataPath: string | null | undefined;
  signalHandlersInstalled: boolean;
  /** Set once `Mochi.serve()` installs its own shutdown handlers, which drain queues. */
  serveOwnsShutdown: boolean;
}

// Pinned so the registry is shared across any duplicate bundled copy of this
// module (mirrors `mochiEvents` / `requestContext`). The shutdown path and the
// standalone signal handlers must see every queue and worker, wherever created.
const registry = pinGlobal<QueueRegistry>('__mochi_queue_registry__', () => ({
  queues: new Set(),
  workers: new Set(),
  queuesByName: new Map(),
  workersByName: new Map(),
  warnedReregister: new Set(),
  dataPath: undefined,
  signalHandlersInstalled: false,
  serveOwnsShutdown: false,
}));

/**
 * Called by `Mochi.serve()` so the standalone signal handlers below stand down:
 * with a server running, `serve()` drives shutdown (and drains queues via
 * `closeAllQueueResources()`), so the queue handler must not also `process.exit`.
 */
export function markServeOwnsShutdown(): void {
  registry.serveOwnsShutdown = true;
}

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

export function createQueue<T>(name: string, opts?: MochiQueueOptions): MochiQueue<T> {
  rememberDataPath(opts?.dataPath);

  // Idempotent per name (like createWorker): a producer handle is a singleton,
  // and the dev route-HMR watcher re-runs the defining module repeatedly. Return
  // the existing handle so handles don't accumulate in the registry. Silent —
  // unlike a worker, re-getting a queue has no processor that could go stale.
  const existing = registry.queuesByName.get(name);
  if (existing) {
    return existing as unknown as MochiQueue<T>;
  }

  const queue = new Queue<T>(name, {
    embedded: true,
    dataPath: opts?.dataPath,
    defaultJobOptions: toBunJobOptions(opts?.defaultJobOptions),
    ...opts?.bunqueue,
  });

  const handle: MochiQueue<T> = {
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
    async close() {
      registry.queues.delete(handle);
      registry.queuesByName.delete(name);
      queue.close();
    },
  };
  const registered: Closeable = handle;
  registry.queues.add(registered);
  registry.queuesByName.set(name, registered);
  return handle;
}

export function createWorker<T, R = unknown>(name: string, processor: MochiProcessor<T, R>, opts?: MochiWorkerOptions): MochiWorker<T, R> {
  rememberDataPath(opts?.dataPath);

  const existing = registry.workersByName.get(name);
  if (existing) {
    // The dev route-HMR watcher re-bundles and re-executes route modules (and
    // everything they import) to hot-swap routes, so a top-level
    // `Mochi.worker()` call can run again within the same process. Keep the
    // FIRST worker — the one the running server's live handlers are bound to —
    // and ignore the re-registration, rather than swapping in a second consumer
    // whose processor closure (and any module-level state it captures) has
    // diverged from those handlers. The trade-off is that worker code/option
    // changes don't hot-reload; a server restart applies them.
    if (!registry.warnedReregister.has(name)) {
      registry.warnedReregister.add(name);
      logger.warn(
        `[queue] worker "${name}" is already registered — keeping the running instance. Dev route-reload re-runs worker modules; restart the server to apply changes to its processor or options.`,
      );
    }
    return existing as unknown as MochiWorker<T, R>;
  }

  const worker = new Worker<T, R>(name, (job) => processor(toMochiJob(job as Job<T>, name)), {
    embedded: true,
    dataPath: opts?.dataPath,
    concurrency: opts?.concurrency,
    ...opts?.bunqueue,
  });

  const listeners: { [K in keyof MochiWorkerEventMap<T, R>]: Set<MochiWorkerEventMap<T, R>[K]> } = {
    active: new Set(),
    completed: new Set(),
    failed: new Set(),
    error: new Set(),
  };

  // bunqueue's `finishedOn`/`processedOn` are unreliable on the public job at
  // event time, so measure duration ourselves from the `active` event.
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
    for (const l of listeners.active) {
      l(mj);
    }
  });

  worker.on('completed', (job, result) => {
    mochiEvents.emit('queue:completed', { queue: name, jobId: job.id, jobName: job.name, attempt: job.attemptsMade + 1, duration: durationFor(job.id) });
    const mj = toMochiJob(job as Job<T>, name);
    for (const l of listeners.completed) {
      l(mj, result);
    }
  });

  worker.on('failed', (job, error) => {
    mochiEvents.emit('queue:failed', { queue: name, jobId: job.id, jobName: job.name, attempt: job.attemptsMade + 1, duration: durationFor(job.id), error: error.message });
    const mj = toMochiJob(job as Job<T>, name);
    for (const l of listeners.failed) {
      l(mj, error);
    }
  });

  worker.on('error', (error) => {
    mochiEvents.emit('queue:error', { queue: name, error: error.message });
    for (const l of listeners.error) {
      l(error);
    }
  });

  const handle: MochiWorker<T, R> = {
    name,
    on(event, listener) {
      listeners[event].add(listener);
      return this;
    },
    async close() {
      registry.workers.delete(handle);
      if (registry.workersByName.get(name) === handle) {
        registry.workersByName.delete(name);
      }
      await worker.close();
    },
  };
  const registered: Closeable = handle;
  registry.workers.add(registered);
  registry.workersByName.set(name, registered);

  ensureStandaloneSignalHandlers();
  return handle;
}

/**
 * Gracefully close every queue and worker created via `Mochi.queue/worker`.
 * Workers first (stop pulling new jobs), then queues. Idempotent and never
 * throws — safe to call from both `Mochi.serve()`'s shutdown path and the
 * standalone signal handlers.
 */
export async function closeAllQueueResources(): Promise<void> {
  const workers = [...registry.workers];
  const queues = [...registry.queues];
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled(queues.map((q) => q.close()));
}

/**
 * Install one-shot SIGTERM/SIGINT handlers that drain queues on exit. Covers the
 * standalone-worker-process case (a file that only calls `Mochi.worker()`,
 * never `Mochi.serve()`). When a server *is* running, `Mochi.serve()` also
 * drains via `closeAllQueueResources()` — that call is idempotent, so the
 * double path is harmless.
 */
function ensureStandaloneSignalHandlers(): void {
  if (registry.signalHandlersInstalled) {
    return;
  }
  registry.signalHandlersInstalled = true;
  let shuttingDown = false;
  const handle = async (): Promise<void> => {
    if (registry.serveOwnsShutdown) {
      return;
    }
    if (shuttingDown) {
      process.exit(1);
    }
    shuttingDown = true;
    await closeAllQueueResources();
    process.exit(0);
  };
  process.once('SIGTERM', handle);
  process.once('SIGINT', handle);
}
