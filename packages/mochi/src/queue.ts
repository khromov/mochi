/**
 * The single isolation boundary around bunqueue: the only module that imports
 * `bunqueue/client`, with no bunqueue type leaking into the public surface, so
 * swapping the backend means rewriting just this file.
 */
import { Queue, Worker, shutdownManager } from 'bunqueue/client';
import type { Job, JobOptions } from 'bunqueue/client';
import { pinGlobal } from './globalState';
import { mochiEvents } from './events';
import { logger } from './log';

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

export interface MochiQueueOptions {
  /** Omit for in-memory. bunqueue locks the path to the first queue/worker in the process — see `rememberDataPath`. */
  dataPath?: string;
  defaultJobOptions?: MochiJobOptions;
  bunqueue?: Record<string, unknown>;
}

export interface MochiWorkerOptions {
  concurrency?: number;
  dataPath?: string;
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
  /** Live worker count per queue name; drives the "enqueued but no consumer" warning. */
  workersByName: Map<string, number>;
  /** Queue names already warned about (no mounted worker) — warn once, not per `add()`. */
  warnedMissingWorker: Set<string>;
  /** First `dataPath` seen; bunqueue ignores later differing paths in the same process. */
  dataPath: string | null | undefined;
}

// Pinned so the registry is shared across any duplicate bundled copy of this
// module (mirrors `mochiEvents` / `requestContext`). The shutdown path
// (`closeAllQueueResources`) must see every queue and worker to drain it,
// wherever — and by whichever bundled copy — it was created.
const registry = pinGlobal<QueueRegistry>('__mochi_queue_registry__', () => ({
  queues: new Set(),
  workers: new Set(),
  queuesByName: new Map(),
  workersByName: new Map(),
  warnedMissingWorker: new Set(),
  dataPath: undefined,
}));

/**
 * Warn (once per queue name) when a job is enqueued to a queue that has no
 * mounted worker — in embedded mode that job will sit unconsumed forever, so
 * this is almost always a typo'd queue name or a worker missing from
 * `Mochi.serve({ workers })`.
 */
function warnIfNoConsumer(name: string): void {
  if ((registry.workersByName.get(name) ?? 0) > 0 || registry.warnedMissingWorker.has(name)) {
    return;
  }
  registry.warnedMissingWorker.add(name);
  logger.warn(
    `[queue] enqueued to "${name}" but no worker is mounted for it — the job won't be processed. Mount one via Mochi.serve({ workers: { '${name}': Mochi.worker(...) } }).`,
  );
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

  // A producer handle is a singleton per name; the dev route-HMR watcher re-runs
  // the defining module repeatedly, so reuse the existing handle instead of
  // accumulating duplicates in the registry. Note the cached handle's `T` is not
  // revalidated — `Mochi.queue<A>('x')` then `Mochi.queue<B>('x')` returns the
  // same handle typed as `B`; with one queue name per payload type this is moot.
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
      warnIfNoConsumer(name);
      const job = await queue.add(jobName, data, toBunJobOptions(jobOpts));
      mochiEvents.emit('queue:added', { queue: name, jobId: job.id, jobName: job.name });
      return { id: job.id, name: job.name };
    },
    async addBulk(jobs) {
      warnIfNoConsumer(name);
      const created = await queue.addBulk(jobs.map((j) => ({ name: j.name, data: j.data, opts: toBunJobOptions(j.opts) })));
      for (const job of created) {
        mochiEvents.emit('queue:added', { queue: name, jobId: job.id, jobName: job.name });
      }
      return created.map((job) => ({ id: job.id, name: job.name }));
    },
    async close() {
      registry.queues.delete(handle);
      registry.queuesByName.delete(name);
      // bunqueue's Queue.close() is synchronous (returns void) — only Worker.close()
      // is async — so there's nothing to await here.
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
      const remaining = (registry.workersByName.get(name) ?? 1) - 1;
      if (remaining > 0) {
        registry.workersByName.set(name, remaining);
      } else {
        registry.workersByName.delete(name);
      }
      await worker.close();
    },
  };
  registry.workers.add(handle);
  registry.workersByName.set(name, (registry.workersByName.get(name) ?? 0) + 1);
  // A worker now consumes this name; clear any prior "no consumer" latch so a
  // producer created before the worker mounted doesn't keep silencing real ones.
  registry.warnedMissingWorker.delete(name);
  return handle;
}

/**
 * Workers first (stop pulling new jobs), then queues. Idempotent and never
 * throws, so it's safe on both the serve shutdown path and the build drain path.
 */
export async function closeAllQueueResources(): Promise<void> {
  const workers = [...registry.workers];
  const queues = [...registry.queues];
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled(queues.map((q) => q.close()));
  // Embedded mode keeps a process-global manager (open SQLite handle + several
  // un-unref'd background intervals). Closing individual handles doesn't touch
  // it, so without this the SQLite file stays locked (Windows rm -> EBUSY) and
  // the intervals keep the event loop alive (the process never exits). Sync and
  // idempotent, so it's safe on the double-call path.
  shutdownManager();
  // The manager is gone, so the embedded store's first-path lock is released too;
  // reset the remembered path (and the warning latches) so a fresh queue/worker
  // created afterwards starts clean rather than warning against a stale path.
  registry.dataPath = undefined;
  registry.warnedMissingWorker.clear();
}
