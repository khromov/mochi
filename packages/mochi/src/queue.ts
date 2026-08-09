// The isolation boundary around bun-boss: the only module importing `bun-boss`, and the only one whose rewrite a
// backend swap would need.
import { BunBoss, fromBunSqlite, fromPglite } from 'bun-boss';
import type { JobInsert, JobResult, JobWithMetadata, PGliteLike, SendOptions, UpdateQueueOptions, WorkOptions } from 'bun-boss';
import { SQL } from 'bun';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { toPosixPath } from './utils';
import { isBuilding } from './utils/buildFlag';
import { pinGlobal } from './utils/globalState';
import { applyFilter } from './extensions';
import { startupMilestoneReached } from './lifecycle';
import { mochiEvents } from './events';
import { logger } from './utils/log';

/**
 * Where queue jobs live: `'memory'` (SQLite `:memory:`, lost on restart), a SQLite file, a Postgres database, or a
 * caller-owned embedded PGlite instance (Mochi never closes it).
 */
export type MochiQueueStorage = 'memory' | { sqlite: string } | { postgres: string } | { pglite: PGliteLike };
export type { PGliteLike };

const storageChecks: Record<string, (value: unknown) => boolean> = {
  sqlite: (value) => typeof value === 'string' && value.length > 0,
  postgres: (value) => typeof value === 'string' && value.length > 0,
  pglite: (value) => {
    const instance = value as Partial<PGliteLike> | null;
    return typeof instance === 'object' && instance !== null && typeof instance.query === 'function' && typeof instance.exec === 'function';
  },
};

/** Runtime-validates what the types already promise, because `queueStorage` often arrives from untyped config. */
export function isValidQueueStorage(storage: MochiQueueStorage): boolean {
  if (storage === 'memory') {
    return true;
  }
  if (typeof storage !== 'object' || storage === null) {
    return false;
  }
  const [entry, ...extra] = Object.entries(storageChecks).filter(([key]) => key in storage);
  if (!entry || extra.length > 0) {
    return false;
  }
  const [key, check] = entry;
  return check((storage as unknown as Record<string, unknown>)[key]);
}

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

/**
 * Advanced fetch-time worker tuning, forwarded to bun-boss verbatim; Mochi-owned settings win where they overlap.
 * Nothing here is persisted on the queue — these only shape how a worker fetches.
 */
export interface MochiWorkerTuning {
  /** Skip the created-on sort when fetching, trading strict FIFO for a cheaper fetch. bun-boss default: true. */
  orderByCreatedOn?: boolean;
  /** Fetch higher-priority jobs first. bun-boss default: true. */
  priority?: boolean;
  /** Only fetch jobs with at least this priority. */
  minPriority?: number;
  /** Only fetch jobs with at most this priority. */
  maxPriority?: number;
  /** Also fetch jobs whose `startAfter` has not been reached yet. */
  ignoreStartAfter?: boolean;
  /** Seconds between polls while LISTEN/NOTIFY is active. */
  notifyPollingIntervalSeconds?: number;
  /** Fetch continuously, with no poll delay, while the queue's cached ready-count exceeds this. */
  burstWhenReadyExceeds?: number;
  /** Seconds between heartbeat refreshes; must be less than the queue's `heartbeatSeconds`. */
  heartbeatRefreshSeconds?: number;
}

/** The non-processor settings of a queue — what survives on `MochiQueueConfig.options`. */
export interface MochiQueueRuntimeOptions {
  /** Jobs of this queue processed in parallel in this process. */
  concurrency?: number;
  /** Seconds between idle fetches; must be >= 0.5. Adds from this process wake the worker immediately regardless. */
  pollingIntervalSeconds?: number;
  /** Jobs fetched per poll (default 1). `process` still runs once per job, each settled and retried on its own. */
  batchSize?: number;
  /** Keep fetching with no poll delay while fetches return full batches — drains cross-process backlogs fast. Needs `batchSize` > 1. */
  burst?: boolean;
  /** Advanced fetch-time worker tuning; see `MochiWorkerTuning`. */
  worker?: MochiWorkerTuning;
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

/** The full config object passed to `Mochi.queue(name, { process, … })`. */
export interface MochiQueueOptions<T, R = unknown> extends MochiQueueRuntimeOptions {
  /** Optional so a queue can exist purely to receive jobs — e.g. a dead-letter holding pen drained via `Mochi.boss()`. */
  process?: MochiProcessor<T, R>;
  on?: Partial<MochiQueueListeners<T, R>>;
  /**
   * The app's queue storage, declared on the descriptor: a standalone producer's first `add*()` lazily connects a
   * producer-only runtime to it, and `Mochi.serve()` inherits it when `queueStorage` is unset. An app has one queue
   * storage — a conflicting declaration anywhere is a boot error.
   */
  storage?: MochiQueueStorage;
}

/** The producer surface of a queue — what you add jobs through. */
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
 * What `Mochi.queue(name, …)` returns: both the declaration `Mochi.serve({ queues })` mounts and a directly-usable
 * producer handle. In a process that never serves, the first `add*()` lazily connects to the declared `storage`.
 */
export interface MochiQueueDescriptor<T = unknown, R = unknown> extends MochiQueue<T> {
  readonly __mochiQueue: true;
  readonly process?: MochiProcessor<T, R>;
  readonly options?: MochiQueueRuntimeOptions;
  readonly on?: Partial<MochiQueueListeners<T, R>>;
  readonly storage?: MochiQueueStorage;
  /**
   * Stop this queue in this process: deregister its worker (waiting for in-flight jobs) and release its claim on the
   * shared runtime — the runtime closes when the last active queue stops. Standalone only; under `Mochi.serve()`
   * queues stop with the server.
   */
  stop(): Promise<void>;
}

/**
 * Matches `MochiQueueConfig` in types.ts without importing it — types.ts imports from this module, not the reverse.
 * `never` keeps a caller's typed processor/listeners assignable (contravariance) without an unsafe cast at every call site.
 */
interface MountableQueue {
  name: string;
  process?: MochiProcessor<never, unknown>;
  options?: MochiQueueRuntimeOptions;
  on?: Partial<MochiQueueListeners<never, never>>;
  storage?: MochiQueueStorage;
}

interface QueueRegistry {
  boss: BunBoss | null;
  /** The SQL instance we own for sqlite/memory storage; null for postgres, whose pool bun-boss owns and closes. */
  ownedSql: { close(): Promise<void> } | null;
  /** Producer handles, keyed by name; what `getQueue()` resolves. */
  byName: Map<string, MochiQueue<unknown>>;
  /** Worker ids per queue, so adds from this process can skip the poll delay via `notifyWorker`. */
  workIds: Map<string, string>;
  /** Who started the runtime: serve owns workers and the option re-sync; standalone is producer-only. */
  kind: 'serve' | 'standalone' | null;
  /** Storage the running boss was started with, for identity checks against later connect attempts. */
  storage: MochiQueueStorage | null;
  /** In-flight standalone boot, so concurrent first-adds share one `start()`. */
  starting: Promise<void> | null;
  /** Per-queue ensure-exists memo for standalone producers. */
  ensured: Map<string, Promise<void>>;
}

// Pinned so every duplicate bundled copy of this module shares one registry, since `closeAllQueueResources` must see
// every resource to drain it whichever copy created it.
const registry = pinGlobal<QueueRegistry>('__mochi_queue_registry__', () => ({
  boss: null,
  ownedSql: null,
  byName: new Map(),
  workIds: new Map(),
  kind: null,
  storage: null,
  starting: null,
  ensured: new Map(),
}));

export function storageEquals(a: MochiQueueStorage | null, b: MochiQueueStorage): boolean {
  if (a === null) {
    return false;
  }
  if (a === 'memory' || b === 'memory') {
    return a === b;
  }
  if ('sqlite' in a && 'sqlite' in b) {
    return path.resolve(a.sqlite) === path.resolve(b.sqlite);
  }
  if ('postgres' in a && 'postgres' in b) {
    return a.postgres === b.postgres;
  }
  if ('pglite' in a && 'pglite' in b) {
    return a.pglite === b.pglite;
  }
  return false;
}

// Postgres URLs carry credentials and PGlite instances aren't printable, so those are identified by kind alone.
function describeStorage(storage: MochiQueueStorage | null): string {
  if (storage === null) {
    return '(none)';
  }
  if (storage === 'memory') {
    return "'memory'";
  }
  if ('sqlite' in storage) {
    return `{ sqlite: "${toPosixPath(storage.sqlite)}" }`;
  }
  return 'pglite' in storage ? '{ pglite: … }' : '{ postgres: … }';
}

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
  const filtered = applyFilter('queue:expireInSeconds', declared ?? DEFAULT_EXPIRE_IN_SECONDS, {
    queue: name,
    explicit: declared !== undefined,
  });
  // Sent only when declared or filter-overridden: an unchanged default stays omitted so a bare mount on shared durable
  // storage keeps (not resets) another deployment's stored expiry, matching every other option's COALESCE semantics.
  const expireInSeconds = declared !== undefined || filtered !== DEFAULT_EXPIRE_IN_SECONDS ? filtered : undefined;
  const { retryLimit, retryDelay, retryBackoff, retryDelayMax, retentionSeconds, deleteAfterSeconds, deadLetter } = options ?? {};
  return omitUndefined({ expireInSeconds, retryLimit, retryDelay, retryBackoff, retryDelayMax, retentionSeconds, deleteAfterSeconds, deadLetter });
}

function requireBoss(): BunBoss {
  if (!registry.boss) {
    throw new Error(
      'Mochi.boss(): the queue runtime is not running. It starts when Mochi.serve({ queues }) mounts a non-empty queues array (call from the "mochi:queuesMounted" hook onwards), or when a standalone Mochi.queue(name, { storage }) descriptor performs its first add.',
    );
  }
  return registry.boss;
}

/**
 * Create and start the shared BunBoss instance for the given storage — one per process. Called by `Mochi.serve()` when
 * its `queues` array is non-empty and by the lazy standalone-producer path; `start()` installs bun-boss's schema on
 * first run against a fresh store.
 */
/**
 * Reject a serve whose queueStorage differs from an already-connected standalone producer runtime. Called by
 * `Mochi.serve()` during fail-fast validation — before the config singleton pins and the server binds — and again by
 * `startQueueRuntime` as a belt-and-braces for a standalone connect racing the serve boot.
 */
export function assertNoConflictingStandaloneRuntime(storage: MochiQueueStorage): void {
  if (registry.boss && registry.kind === 'standalone' && !storageEquals(registry.storage, storage)) {
    throw new Error(
      `Mochi.serve({ queueStorage }): a standalone queue runtime is already connected to ${describeStorage(registry.storage)}, which is not the serve queueStorage ${describeStorage(storage)}. Use the same storage in both, or Mochi.stop() first.`,
    );
  }
}

export async function startQueueRuntime(storage: MochiQueueStorage, opts?: { kind?: 'serve' | 'standalone'; enableSpies?: boolean }): Promise<void> {
  const kind = opts?.kind ?? 'serve';
  // Whoever booted first wins: waiting on the shared in-flight promise (each iteration a distinct one) is what keeps a
  // lazy standalone connect racing a serve boot from creating two BunBoss instances and leaking the loser.
  while (registry.starting) {
    await registry.starting.catch(() => {});
  }
  if (registry.boss) {
    if (kind === 'serve' && registry.kind === 'standalone') {
      assertNoConflictingStandaloneRuntime(storage);
      // Serve adopts a standalone producer runtime on the same storage; mountQueues then layers workers and the
      // option re-sync on top of it. Producer handles reset so only queues the serve declares stay producible —
      // otherwise whether an undeclared queue can produce would depend on whether it raced the boot.
      registry.kind = 'serve';
      registry.byName.clear();
      registry.ensured.clear();
      return;
    }
    if (kind === 'standalone') {
      // A concurrent caller booted while we waited; callers re-validate storage/name against the registry.
      return;
    }
    throw new Error('The Mochi queue runtime is already running — Mochi.serve() starts it once per process.');
  }
  registry.starting = bootQueueRuntime(storage, kind, opts?.enableSpies ?? false).finally(() => {
    registry.starting = null;
  });
  await registry.starting;
}

async function bootQueueRuntime(storage: MochiQueueStorage, kind: 'serve' | 'standalone', enableSpies: boolean): Promise<void> {
  const spies = enableSpies ? { __test__enableSpies: true } : {};
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
  } else if ('pglite' in storage) {
    // The caller constructs and owns the PGlite instance (bun-boss's adapter contract), so nothing is registered for closing.
    boss = new BunBoss({ backend: 'pglite', db: fromPglite(storage.pglite), schema: 'mochi_queue', schedule: false, ...spies });
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
  try {
    await boss.start();
  } catch (err) {
    // bun-boss defers cleanup of a partially-started instance (maintenance intervals, the postgres pool) to stop(),
    // and registry.boss is still null here, so it must be stopped inline; the owned SQL handle likewise — calling
    // closeAllQueueResources() here would deadlock, since it awaits this very boot promise.
    await boss.stop({ graceful: false }).catch(() => {});
    const sql = registry.ownedSql;
    registry.ownedSql = null;
    if (sql) {
      await sql.close().catch(() => {});
    }
    throw err;
  }
  registry.boss = boss;
  registry.kind = kind;
  registry.storage = storage;
}

// A throwing listener or bus subscriber must not decide a job's fate — only `process` may — nor reject an add()
// whose job is already persisted, which a caller could mistake for "not enqueued" and retry into a duplicate.
function notifySafely(queue: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    logger.error(`[queue] ${queue}: listener threw — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * bun-boss times the whole handler invocation out at the batch's max `expireInSeconds` — not the sum — and that
 * timeout fails every job in the batch wholesale, completed ones included. Multi-job batches therefore get an
 * in-handler deadline just under bun-boss's, so the handler settles early and completed siblings keep their results;
 * a single-job batch has no siblings to protect and keeps bun-boss's own expiry semantics.
 */
function batchDeadline(batch: JobWithMetadata<unknown>[]): number {
  if (batch.length < 2) {
    return Infinity;
  }
  const budgetMs = batch.reduce((acc, job) => Math.max(acc, job.expireInSeconds), 0) * 1000;
  if (budgetMs <= 0) {
    return Infinity;
  }
  return performance.now() + budgetMs - Math.min(1_000, budgetMs * 0.1);
}

async function withDeadline<R>(work: R | Promise<R>, deadlineAt: number, onTimeout: () => Error): Promise<R> {
  if (deadlineAt === Infinity) {
    return work;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), Math.max(0, deadlineAt - performance.now()));
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

function makeHandler<T, R>(name: string, process: MochiProcessor<T, R>, listeners?: Partial<MochiQueueListeners<T, R>>) {
  // Sequential on purpose: parallelism is owned by `concurrency` (workers), so a batch never multiplies it — and jobs
  // settle per-job via `perJobResults`, so one throw fails only its own job while siblings complete.
  return async (batch: JobWithMetadata<T>[]): Promise<JobResult[]> => {
    const results: JobResult[] = [];
    const deadlineAt = batchDeadline(batch);
    for (const raw of batch) {
      const job: MochiJob<T> = {
        id: raw.id,
        data: raw.data,
        queue: name,
        attempt: raw.retryCount + 1,
        // The sqlite backend may hand timestamps back as ISO strings rather than Dates.
        enqueuedAt: new Date(raw.createdOn).getTime(),
      };
      const start = performance.now();
      if (start >= deadlineAt) {
        const error = new Error(`the batch's shared expireInSeconds budget ran out before this job started; it is failed for retry`);
        notifySafely(name, () => mochiEvents.emit('queue:failed', { queue: name, jobId: job.id, attempt: job.attempt, duration: 0, error: error.message }));
        notifySafely(name, () => listeners?.failed?.(job, error));
        results.push({ id: raw.id, status: 'failed', output: error });
        continue;
      }
      notifySafely(name, () => mochiEvents.emit('queue:active', { queue: name, jobId: job.id, attempt: job.attempt }));
      notifySafely(name, () => listeners?.active?.(job));
      try {
        const result = await withDeadline(
          process(job),
          deadlineAt,
          () => new Error(`the batch's shared expireInSeconds budget ran out mid-job; it is failed for retry (its processor may still be running)`),
        );
        notifySafely(name, () => mochiEvents.emit('queue:completed', { queue: name, jobId: job.id, attempt: job.attempt, duration: performance.now() - start }));
        notifySafely(name, () => listeners?.completed?.(job, result));
        results.push({ id: raw.id, status: 'completed', output: result });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        notifySafely(name, () => mochiEvents.emit('queue:failed', { queue: name, jobId: job.id, attempt: job.attempt, duration: performance.now() - start, error: error.message }));
        notifySafely(name, () => listeners?.failed?.(job, error));
        // The raw Error, not a plucked message: bun-boss serializes an Error output with name/stack/cause intact, so
        // the durable store keeps the full failure detail.
        results.push({ id: raw.id, status: 'failed', output: error });
      }
    }
    return results;
  };
}

function producerMethods<T>(name: string): MochiQueue<T> {
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
      notifySafely(name, () => mochiEvents.emit('queue:added', { queue: name, jobId }));
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
        notifySafely(name, () => mochiEvents.emit('queue:added', { queue: name, jobId, bulk: true }));
      }
      if (ids.length > 0) {
        // One summary event per call — the console logger prints this instead of the N `bulk`-flagged per-job lines.
        notifySafely(name, () => mochiEvents.emit('queue:addedBulk', { queue: name, count: ids.length, jobIds: ids }));
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

const QUEUE_NAME_RE = /^[\w.\-/]+$/;

function noStorageError(name: string): Error {
  return new Error(
    `Mochi.queue("${name}"): this queue has no storage and no Mochi.serve({ queues }) has mounted it. Declare it as Mochi.queue("${name}", { storage: … }) to produce to it standalone, or include it in the Mochi.serve({ queues }) array.`,
  );
}

function storageMismatchError(name: string, storage: MochiQueueStorage): Error {
  return new Error(
    `Mochi.queue("${name}"): the queue runtime is already connected to ${describeStorage(registry.storage)}, but this descriptor declares storage ${describeStorage(storage)}. One queue runtime per process — give every declaration of a queue the same storage.`,
  );
}

/**
 * Make a descriptor's producer methods callable: a no-op when the queue is already mounted/ensured, otherwise the lazy
 * standalone path — boot a producer-only runtime against the descriptor's storage and ensure the queue exists.
 */
async function ensureUsable(descriptor: MountableQueue): Promise<void> {
  const { name, storage } = descriptor;
  if (registry.boss && registry.byName.has(name)) {
    // The hot-path early return still checks storage identity: a same-name descriptor declaring a different storage
    // would otherwise silently write its jobs into whichever store connected first.
    if (storage !== undefined && !storageEquals(registry.storage, storage)) {
      throw storageMismatchError(name, storage);
    }
    return;
  }
  while (!registry.boss) {
    if (registry.starting) {
      await registry.starting.catch(() => {});
      continue;
    }
    if (!storage) {
      throw noStorageError(name);
    }
    await startQueueRuntime(storage, { kind: 'standalone' });
  }
  assertProducibleUnderServe(name);
  if (storage !== undefined) {
    if (!storageEquals(registry.storage, storage)) {
      throw storageMismatchError(name, storage);
    }
  } else if (!registry.byName.has(name)) {
    throw noStorageError(name);
  }
  await ensureQueueExists(name, descriptor.options);
  // Re-checked after the await: a serve boot may have adopted the runtime mid-ensure, and registering an undeclared
  // producer past the adoption would make producibility depend on who won that race.
  assertProducibleUnderServe(name);
  if (!registry.byName.has(name)) {
    registry.byName.set(name, producerMethods(name));
  }
}

function assertProducibleUnderServe(name: string): void {
  if (registry.kind !== 'serve' || registry.byName.has(name)) {
    return;
  }
  // Told apart by the startup milestone: during the boot window "not mounted" is transient, not a declaration error.
  if (!startupMilestoneReached('mochi:queuesMounted')) {
    throw new Error(
      `Mochi.queue("${name}"): Mochi.serve() is still booting — queues mount right after the server binds. Add jobs from the "mochi:queuesMounted" hook (or "mochi:ready", or any request handler) onwards.`,
    );
  }
  throw new Error(
    `Mochi.queue("${name}"): this queue is not in this process's Mochi.serve({ queues }) array (mounted: ${[...registry.byName.keys()].join(', ') || 'none'}). One queue runtime per process — declare it there to produce to it here.`,
  );
}

async function stopQueue(name: string): Promise<void> {
  const boss = registry.boss;
  if (!boss) {
    return;
  }
  if (registry.kind === 'serve') {
    throw new Error(`Mochi.queue("${name}").stop(): this process is serving — queues stop with the server (SIGTERM/SIGINT or Mochi.stop()).`);
  }
  const workId = registry.workIds.get(name);
  if (workId) {
    await boss.offWork(name, { id: workId, wait: true }).catch(() => {});
    registry.workIds.delete(name);
  }
  registry.byName.delete(name);
  registry.ensured.delete(name);
  // The runtime is shared, so it closes only when the last active queue lets go.
  if (registry.byName.size === 0) {
    await closeAllQueueResources();
  }
}

// Ensure-only creation (createQueue is ON CONFLICT DO NOTHING) and never updateQueue: the standalone paths must not
// rewrite options a Mochi.serve() deployment owns. deadLetter is dropped because its target queue may not exist here.
async function ensureQueueExists(name: string, options: MochiQueueRuntimeOptions | undefined): Promise<void> {
  let ensured = registry.ensured.get(name);
  if (!ensured) {
    const { deadLetter: _, ...createOptions } = toBossQueueOptions(name, options);
    ensured = requireBoss()
      .createQueue(name, createOptions)
      .catch((err: unknown) => {
        registry.ensured.delete(name);
        throw err;
      });
    registry.ensured.set(name, ensured);
  }
  await ensured;
}

/** Implements `Mochi.queue(name, config)` — see its JSDoc there. */
export function createQueueDescriptor<T = unknown, R = unknown>(name: string, config: MochiQueueOptions<T, R> = {}): MochiQueueDescriptor<T, R> {
  if (!QUEUE_NAME_RE.test(name)) {
    throw new Error(`Mochi.queue("${name}"): not a valid queue name. Names may only contain letters, digits, underscores, dots, dashes, and slashes.`);
  }
  const { process, on, storage, ...options } = config;
  if (storage !== undefined && !isValidQueueStorage(storage)) {
    throw new Error(`Mochi.queue("${name}", { storage }): expected 'memory', { sqlite: 'path/to.db' }, { postgres: url }, or { pglite: instance }.`);
  }
  if (options.batchSize !== undefined && (!Number.isInteger(options.batchSize) || options.batchSize < 1)) {
    throw new Error(`Mochi.queue("${name}", { batchSize }): expected an integer >= 1.`);
  }
  const base = producerMethods<T>(name);
  const descriptor: MochiQueueDescriptor<T, R> = {
    __mochiQueue: true,
    name,
    process,
    on,
    storage,
    options,
    async add(data, opts) {
      // A `mochi-framework build` imports the app entry for real; adds are suppressed there so a build never connects
      // to (or writes into) the app's production storage.
      if (isBuilding) {
        return null;
      }
      await ensureUsable(descriptor);
      return base.add(data, opts);
    },
    async addBulk(jobs) {
      if (isBuilding) {
        return [];
      }
      await ensureUsable(descriptor);
      return base.addBulk(jobs);
    },
    async addThrottled(data, seconds, key, opts) {
      if (isBuilding) {
        return null;
      }
      await ensureUsable(descriptor);
      return base.addThrottled(data, seconds, key, opts);
    },
    async addDebounced(data, seconds, key, opts) {
      if (isBuilding) {
        return null;
      }
      await ensureUsable(descriptor);
      return base.addDebounced(data, seconds, key, opts);
    },
    async stop() {
      if (isBuilding) {
        return;
      }
      await stopQueue(name);
    },
  };
  return descriptor;
}

/**
 * Mount every queue declared in `Mochi.serve({ queues })` on the running boss: ensure each exists with its declared
 * config, then start a worker for each that has a processor.
 */
export async function mountQueues(queues: MountableQueue[]): Promise<void> {
  const boss = requireBoss();
  const resolved = queues.map((config) => ({ name: config.name, config, bossOptions: toBossQueueOptions(config.name, config.options) }));
  // createQueue validates that a deadLetter target already exists and is ON CONFLICT DO NOTHING, so pass 1 creates
  // every queue without deadLetter and pass 2 updates with the full set — declaration order stops mattering. The
  // re-sync is additive only: updateQueue COALESCEs absent keys, so an option *removed* from code (deadLetter
  // included — bun-boss can't yet clear it) keeps its persisted value on durable storage.
  for (const { name, bossOptions } of resolved) {
    const { deadLetter: _, ...createOptions } = bossOptions;
    await boss.createQueue(name, createOptions);
  }
  for (const { name, bossOptions } of resolved) {
    // A queue declaring nothing has nothing to re-sync (bun-boss asserts on an empty update).
    if (Object.keys(bossOptions).length > 0) {
      await boss.updateQueue(name, bossOptions);
    }
  }
  for (const { name, config } of resolved) {
    registry.byName.set(name, producerMethods(name));
    if (config.process) {
      await registerQueueWorker(boss, config);
    }
  }
}

async function registerQueueWorker(boss: BunBoss, config: MountableQueue): Promise<void> {
  if (!config.process) {
    return;
  }
  const o = config.options;
  const batchSize = o?.batchSize ?? 1;
  if (o?.burst && batchSize === 1) {
    logger.warn(`[queue] ${config.name}: burst has no effect with batchSize 1 — raise batchSize so there are full fetches to burst on.`);
  }
  const workOptions = omitUndefined({
    // Escape hatch first; Mochi-owned keys below win where they overlap.
    ...omitUndefined({ ...(o?.worker ?? {}) }),
    batchSize,
    includeMetadata: true,
    perJobResults: true,
    localConcurrency: o?.concurrency,
    pollingIntervalSeconds: o?.pollingIntervalSeconds,
    burstWhenBatchFull: o?.burst,
  }) as WorkOptions & { includeMetadata: true; perJobResults: true };
  const workId = await boss.work(config.name, workOptions, makeHandler(config.name, config.process, config.on as Partial<MochiQueueListeners<never, unknown>> | undefined));
  registry.workIds.set(config.name, workId);
}

/** The handle returned by `Mochi.worker()` — start/stop consuming declared queues in a serverless process. */
export interface MochiWorker {
  /** Connect to storage (reusing a standalone runtime on the same storage), ensure the queues exist, and start polling. */
  start(): Promise<void>;
  /** Deregister this worker's queues, waiting for in-flight jobs. The runtime stays up for producers; `Mochi.stop()` tears it down. */
  stop(): Promise<void>;
}

/** Implements `Mochi.worker(options)` — see its JSDoc there. */
export function createWorker(queues: MountableQueue[], storage?: MochiQueueStorage): MochiWorker {
  if (queues.length === 0) {
    throw new Error('Mochi.worker(): declare at least one queue.');
  }
  const names = new Set<string>();
  let declared: { name: string; storage: MochiQueueStorage } | undefined;
  for (const q of queues) {
    if (names.has(q.name)) {
      throw new Error(`Mochi.worker(): two queues are named "${q.name}". Queue names must be unique.`);
    }
    names.add(q.name);
    if (q.storage !== undefined) {
      if (declared && !storageEquals(declared.storage, q.storage)) {
        throw new Error(`Mochi.worker(): "${q.name}" and "${declared.name}" declare different storages — an app has one queue storage.`);
      }
      declared ??= { name: q.name, storage: q.storage };
    }
  }
  if (storage !== undefined) {
    if (!isValidQueueStorage(storage)) {
      throw new Error(`Mochi.worker({ storage }): expected 'memory', { sqlite: 'path/to.db' }, { postgres: url }, or { pglite: instance }.`);
    }
    if (declared && !storageEquals(declared.storage, storage)) {
      throw new Error(`Mochi.worker({ storage }): "${declared.name}" declares a different storage — an app has one queue storage.`);
    }
  }
  const workerStorage = storage ?? declared?.storage;
  let started = false;
  return {
    async start() {
      if (started) {
        throw new Error('Mochi.worker(): this worker was already started.');
      }
      if (isBuilding) {
        return;
      }
      if (!workerStorage) {
        throw new Error('Mochi.worker(): no storage declared. Give a queue descriptor (or the worker) a storage to connect to.');
      }
      started = true;
      try {
        while (!registry.boss) {
          if (registry.starting) {
            await registry.starting.catch(() => {});
            continue;
          }
          await startQueueRuntime(workerStorage, { kind: 'standalone' });
        }
        // Checked after the boot loop on purpose: it also catches a racing Mochi.serve() that won an in-flight boot.
        if (registry.kind === 'serve') {
          throw new Error('Mochi.worker(): this process is serving — declare the queues in Mochi.serve({ queues }) instead.');
        }
        if (!storageEquals(registry.storage, workerStorage)) {
          throw new Error(
            `Mochi.worker(): the queue runtime is already connected to ${describeStorage(registry.storage)}, which is not this worker's storage ${describeStorage(workerStorage)}. An app has one queue storage.`,
          );
        }
        const boss = requireBoss();
        for (const q of queues) {
          await ensureQueueExists(q.name, q.options);
          if (!registry.byName.has(q.name)) {
            registry.byName.set(q.name, producerMethods(q.name));
          }
          await registerQueueWorker(boss, q);
        }
      } catch (err) {
        started = false;
        throw err;
      }
    },
    async stop() {
      const boss = registry.boss;
      if (!boss) {
        return;
      }
      for (const q of queues) {
        const workId = registry.workIds.get(q.name);
        if (workId) {
          await boss.offWork(q.name, { id: workId, wait: true }).catch(() => {});
          registry.workIds.delete(q.name);
        }
      }
    },
  };
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
        `Mochi.getQueue("${name}"): queues are not mounted yet. Mochi.serve({ queues }) mounts them after the "mochi:init" hook and after the server binds, so call getQueue() somewhere that runs later: the "mochi:ready" hook, or any request handler. In a process that never serves, add jobs through the Mochi.queue("${name}", { storage }) descriptor itself — getQueue() resolves a standalone queue only after its first add connects it.`,
      );
    }
    if (registry.byName.size === 0) {
      throw new Error(`Mochi.getQueue("${name}"): no queues were declared. Add it to Mochi.serve({ queues: [Mochi.queue("${name}", …)] }) before adding jobs to it.`);
    }
    throw new Error(
      `Mochi.getQueue("${name}"): no such queue. Declare it via Mochi.serve({ queues: [Mochi.queue("${name}", …)] }) before adding jobs to it. Mounted queues: ${[...registry.byName.keys()].join(', ')}.`,
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
  // A stop racing an in-flight lazy connect must wait for it, so the resulting runtime is torn down here rather than
  // registering itself — live timers, open pool — after the stop reported done.
  while (registry.starting) {
    await registry.starting.catch(() => {});
  }
  const { boss, ownedSql } = registry;
  // Cleared first so a fresh serve in this process (e.g. a test that restarts) can re-mount its queues even if a
  // close below fails.
  registry.boss = null;
  registry.ownedSql = null;
  registry.kind = null;
  registry.storage = null;
  registry.starting = null;
  registry.byName.clear();
  registry.workIds.clear();
  registry.ensured.clear();
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
