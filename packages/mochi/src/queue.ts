// The isolation boundary around bun-boss: the only module importing `bun-boss`, and the only one whose rewrite a
// backend swap would need.
import { BunBoss, fromBunSqlite } from 'bun-boss';
import type { JobInsert, JobWithMetadata, SendOptions, UpdateQueueOptions } from 'bun-boss';
import { SQL } from 'bun';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pinGlobal } from './utils/globalState';
import { applyFilter } from './extensions';
import { startupMilestoneReached } from './lifecycle';
import { mochiEvents } from './events';
import { logger } from './utils/log';

/** Where queue jobs live: `'memory'` (SQLite `:memory:`, lost on restart), a SQLite file, or a Postgres database. */
export type MochiQueueStorage = 'memory' | { sqlite: string } | { postgres: string };

/** Deliberately narrow — data, not bun-boss's job row — so userland can't reach behind the abstraction. */
export interface MochiJob<T> {
  readonly id: string;
  readonly data: T;
  readonly queue: string;
  /** 1-based (bun-boss's `retryCount` is 0 on the first run). */
  readonly attempt: number;
  /** Epoch ms when the job was enqueued. */
  readonly enqueuedAt: number;
}

export type MochiProcessor<T, R> = (job: MochiJob<T>) => R | Promise<R>;

/** Per-add options, bun-boss naming 1:1; every duration is in seconds. */
export interface MochiJobOptions {
  priority?: number;
  /** Seconds to defer the job, or an absolute start time. */
  startAfter?: number | Date;
  /** Explicit id — a second add with the same id resolves `null` instead of duplicating. */
  id?: string;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  retryDelayMax?: number;
  expireInSeconds?: number;
}

/**
 * Lifecycle listeners; the same map is used for the per-queue `on` option and the `MochiQueueListeners` config.
 * Job errors surface through `failed`; instance-level bun-boss errors carry no queue attribution and go only to the
 * `queue:error` bus event.
 */
export interface MochiQueueListeners<T, R> {
  active: (job: MochiJob<T>) => void;
  completed: (job: MochiJob<T>, result: R) => void;
  failed: (job: MochiJob<T>, error: Error) => void;
}

/** The non-processor settings of a queue — what survives on the inert `MochiQueueConfig.options`. */
export interface MochiQueueRuntimeOptions {
  /** Jobs of this queue processed in parallel in this process. */
  concurrency?: number;
  /** Seconds between idle fetches; must be >= 0.5. Adds from this process wake the worker immediately regardless. */
  pollingIntervalSeconds?: number;
  /** Times a failed job is retried before it fails terminally. bun-boss default: 2. */
  retryLimit?: number;
  /** Seconds between retries. bun-boss default: 0. */
  retryDelay?: number;
  /** Exponential backoff on `retryDelay` instead of a fixed delay. */
  retryBackoff?: boolean;
  /** Cap on the backoff delay, in seconds. */
  retryDelayMax?: number;
  /** Seconds a job may stay active before it is retried or failed. bun-boss default: 900. */
  expireInSeconds?: number;
  /** Seconds a job may wait unprocessed before it is deleted. bun-boss default: 14 days. */
  retentionSeconds?: number;
  /** Seconds a completed job is retained. bun-boss default: 7 days. */
  deleteAfterSeconds?: number;
  /** Name of another queue in the same `queues` map; terminally failed jobs move there. */
  deadLetter?: string;
}

/** The full config object passed to `Mochi.queue({ process, … })`. */
export interface MochiQueueOptions<T, R = unknown> extends MochiQueueRuntimeOptions {
  /** Optional so a queue can exist purely to receive jobs — e.g. a dead-letter holding pen drained via `Mochi.boss()`. */
  process?: MochiProcessor<T, R>;
  on?: Partial<MochiQueueListeners<T, R>>;
}

/** Handle returned by `Mochi.getQueue(name)` — what you add jobs through. */
export interface MochiQueue<T> {
  readonly name: string;
  /** Resolves the job id, or `null` when the add was suppressed (duplicate explicit `id`). */
  add(data: T, opts?: MochiJobOptions): Promise<string | null>;
  addBulk(jobs: Array<{ data: T; opts?: MochiJobOptions }>): Promise<string[]>;
  /** At most one job per `seconds` slot (per `key`); suppressed adds resolve `null`. */
  addThrottled(data: T, seconds: number, key?: string, opts?: MochiJobOptions): Promise<string | null>;
  /** Like `addThrottled`, but a suppressed add books the next slot instead of vanishing. */
  addDebounced(data: T, seconds: number, key?: string, opts?: MochiJobOptions): Promise<string | null>;
}

/**
 * Matches `MochiQueueConfig` in types.ts without importing it — types.ts imports from this module, not the reverse.
 * `never` keeps a caller's typed processor assignable (contravariance) without an unsafe cast at every call site.
 */
interface MountableQueueConfig {
  process?: MochiProcessor<never, unknown>;
  options?: MochiQueueRuntimeOptions;
  on?: Partial<MochiQueueListeners<never, unknown>>;
}

interface QueueRegistry {
  boss: BunBoss | null;
  /** The SQL instance we own for sqlite/memory storage; null for postgres, whose pool bun-boss owns and closes. */
  ownedSql: { close(): Promise<void> } | null;
  /** Producer handles, keyed by name; what `getQueue()` resolves. */
  byName: Map<string, MochiQueue<unknown>>;
  /** Worker ids per queue, so adds from this process can skip the poll delay via `notifyWorker`. */
  workIds: Map<string, string>;
}

// Pinned so every duplicate bundled copy of this module shares one registry, since `closeAllQueueResources` must see
// every resource to drain it whichever copy created it.
const registry = pinGlobal<QueueRegistry>('__mochi_queue_registry__', () => ({
  boss: null,
  ownedSql: null,
  byName: new Map(),
  workIds: new Map(),
}));

export const DEFAULT_EXPIRE_IN_SECONDS = 900;

// bun-boss's attorney asserts on key presence, not value, so an explicitly-undefined option must not reach it.
function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}

function toSendOptions(opts: MochiJobOptions | undefined): SendOptions | null {
  if (!opts) {
    return null;
  }
  const { priority, startAfter, id, retryLimit, retryDelay, retryBackoff, retryDelayMax, expireInSeconds } = opts;
  return omitUndefined({ priority, startAfter, id, retryLimit, retryDelay, retryBackoff, retryDelayMax, expireInSeconds });
}

function toJobInsert(data: unknown, opts: MochiJobOptions | undefined): JobInsert {
  return omitUndefined({ data: data as object, ...toSendOptions(opts) });
}

function toBossQueueOptions(name: string, options: MochiQueueRuntimeOptions | undefined): UpdateQueueOptions {
  // Filtered per queue after whatever the queue declared for itself, so a deployment can move the expiry for every
  // queue at once and still see via `explicit` which ones chose a value themselves.
  const declared = options?.expireInSeconds;
  const expireInSeconds = applyFilter('queue:expireInSeconds', declared ?? DEFAULT_EXPIRE_IN_SECONDS, {
    queue: name,
    explicit: declared !== undefined,
  });
  const { retryLimit, retryDelay, retryBackoff, retryDelayMax, retentionSeconds, deleteAfterSeconds, deadLetter } = options ?? {};
  return omitUndefined({ expireInSeconds, retryLimit, retryDelay, retryBackoff, retryDelayMax, retentionSeconds, deleteAfterSeconds, deadLetter });
}

function requireBoss(): BunBoss {
  if (!registry.boss) {
    throw new Error(
      'Mochi.boss(): the queue runtime is not running. It starts when Mochi.serve({ queues }) mounts a non-empty queues map — call it from the "mochi:queuesMounted" hook onwards.',
    );
  }
  return registry.boss;
}

/**
 * Create and start the shared BunBoss instance for the given storage. Called once by `Mochi.serve()` when its `queues`
 * map is non-empty; `start()` installs bun-boss's schema on first run against a fresh store.
 */
export async function startQueueRuntime(storage: MochiQueueStorage, testOptions?: { enableSpies?: boolean }): Promise<void> {
  if (registry.boss) {
    throw new Error('The Mochi queue runtime is already running — Mochi.serve() starts it once per process.');
  }
  const spies = testOptions?.enableSpies ? { __test__enableSpies: true } : {};
  let boss: BunBoss;
  if (storage === 'memory' || 'sqlite' in storage) {
    const file = storage === 'memory' ? ':memory:' : storage.sqlite;
    if (file !== ':memory:') {
      mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    }
    const sql = new SQL(`sqlite://${file}`);
    // Registered before start() so the failure path in Mochi.serve (closeAllQueueResources) closes it too.
    registry.ownedSql = sql;
    boss = new BunBoss({ backend: 'sqlite', db: fromBunSqlite(sql), schedule: false, ...spies });
  } else {
    boss = new BunBoss({ url: storage.postgres, backend: 'postgres', schema: 'mochi_queue', schedule: false, ...spies });
  }
  // Attached before start(): an 'error' emit with no listener kills the process (EventEmitter semantics).
  boss.on('error', (error) => {
    logger.error(`[queue] ${error.message}`);
    mochiEvents.emit('queue:error', { error: error.message });
  });
  boss.on('warning', (warning) => {
    logger.warn(`[queue] ${warning.message}`);
  });
  await boss.start();
  registry.boss = boss;
}

function makeHandler<T, R>(name: string, process: MochiProcessor<T, R>, listeners?: Partial<MochiQueueListeners<T, R>>) {
  return async (batch: JobWithMetadata<T>[]): Promise<R> => {
    const raw = batch[0];
    if (!raw) {
      throw new Error(`[queue] ${name}: bun-boss delivered an empty batch`);
    }
    const job: MochiJob<T> = {
      id: raw.id,
      data: raw.data,
      queue: name,
      attempt: raw.retryCount + 1,
      // The sqlite backend may hand timestamps back as ISO strings rather than Dates.
      enqueuedAt: new Date(raw.createdOn).getTime(),
    };
    const start = performance.now();
    mochiEvents.emit('queue:active', { queue: name, jobId: job.id, attempt: job.attempt });
    listeners?.active?.(job);
    try {
      const result = await process(job);
      mochiEvents.emit('queue:completed', { queue: name, jobId: job.id, attempt: job.attempt, duration: performance.now() - start });
      listeners?.completed?.(job, result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      mochiEvents.emit('queue:failed', { queue: name, jobId: job.id, attempt: job.attempt, duration: performance.now() - start, error: error.message });
      listeners?.failed?.(job, error);
      throw error;
    }
  };
}

function buildProducer<T>(name: string): MochiQueue<T> {
  // Adds wake this process's worker immediately; bun-boss itself only polls (pollingIntervalSeconds), which stays the
  // floor for other processes and for deferred/retried jobs.
  const notify = () => {
    const workId = registry.workIds.get(name);
    if (workId && registry.boss) {
      registry.boss.notifyWorker(workId);
    }
  };
  const emitAdded = (jobId: string | null) => {
    if (jobId !== null) {
      mochiEvents.emit('queue:added', { queue: name, jobId });
      notify();
    }
  };
  return {
    name,
    async add(data, opts) {
      const jobId = await requireBoss().send(name, data as object, toSendOptions(opts) ?? undefined);
      emitAdded(jobId);
      return jobId;
    },
    async addBulk(jobs) {
      const ids =
        (await requireBoss().insert(
          name,
          jobs.map((job) => toJobInsert(job.data, job.opts)),
          { returnId: true },
        )) ?? [];
      for (const jobId of ids) {
        mochiEvents.emit('queue:added', { queue: name, jobId });
      }
      if (ids.length > 0) {
        notify();
      }
      return ids;
    },
    async addThrottled(data, seconds, key, opts) {
      const jobId = await requireBoss().sendThrottled(name, data as object, toSendOptions(opts), seconds, key);
      emitAdded(jobId);
      return jobId;
    },
    async addDebounced(data, seconds, key, opts) {
      const jobId = await requireBoss().sendDebounced(name, data as object, toSendOptions(opts), seconds, key);
      emitAdded(jobId);
      return jobId;
    },
  };
}

/**
 * Mount every queue declared in `Mochi.serve({ queues })` on the running boss: ensure each exists with its declared
 * config, then start a worker for each that has a processor.
 */
export async function mountQueues(entries: Array<[string, MountableQueueConfig]>): Promise<void> {
  const boss = requireBoss();
  const resolved = entries.map(([name, config]) => ({ name, config, bossOptions: toBossQueueOptions(name, config.options) }));
  // createQueue validates that a deadLetter target already exists and is ON CONFLICT DO NOTHING, so pass 1 creates
  // every queue without deadLetter and pass 2 updates with the full set — declaration order stops mattering, and a
  // persisted store's stale config is re-synced to the code on every boot.
  for (const { name, bossOptions } of resolved) {
    const { deadLetter: _, ...createOptions } = bossOptions;
    await boss.createQueue(name, createOptions);
  }
  for (const { name, bossOptions } of resolved) {
    await boss.updateQueue(name, bossOptions);
  }
  for (const { name, config } of resolved) {
    registry.byName.set(name, buildProducer(name));
    if (config.process) {
      const workOptions = omitUndefined({
        batchSize: 1,
        includeMetadata: true as const,
        localConcurrency: config.options?.concurrency,
        pollingIntervalSeconds: config.options?.pollingIntervalSeconds,
      });
      const workId = await boss.work(name, workOptions, makeHandler(name, config.process, config.on));
      registry.workIds.set(name, workId);
    }
  }
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
        `Mochi.getQueue("${name}"): queues are not mounted yet. Mochi.serve({ queues }) mounts them after the "mochi:init" hook and after the server binds, so call getQueue() somewhere that runs later: the "mochi:ready" hook, or any request handler.`,
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

/** The raw bun-boss instance behind `Mochi.boss()` — the escape hatch for everything Mochi doesn't wrap. */
export function getBoss(): BunBoss {
  return requireBoss();
}

/**
 * Stop the boss (waiting for in-flight jobs) and close the owned SQLite handle. Idempotent and never throws, so it's
 * safe on both the serve shutdown path and the build drain path.
 */
export async function closeAllQueueResources(): Promise<void> {
  const { boss, ownedSql } = registry;
  // Cleared first so a fresh serve in this process (e.g. a test that restarts) can re-mount its queues even if a
  // close below fails.
  registry.boss = null;
  registry.ownedSql = null;
  registry.byName.clear();
  registry.workIds.clear();
  if (boss) {
    try {
      await boss.stop({ graceful: true, timeout: 10_000 });
    } catch (err) {
      logger.warn(`[queue] shutdown: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (ownedSql) {
    try {
      await ownedSql.close();
    } catch {
      // The handle may already be closed by a failed start; nothing to do.
    }
  }
}
