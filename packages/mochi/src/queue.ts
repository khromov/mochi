// The isolation boundary around bun-boss: the only module importing `bun-boss`, and the only one whose rewrite a
// backend swap would need.
import { BunBoss, fromBunSqlite, fromPglite, queueOptionDefaults } from 'bun-boss';
import type { JobInsert, JobResult, JobWithMetadata, PGliteLike, SendOptions, UpdateQueueOptions, WorkOptions, Warning } from 'bun-boss';
import { SQL } from 'bun';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { toPosixPath } from './utils';
import { isBuildingEntry } from './utils/buildFlag';
import { pinGlobal } from './utils/globalState';
import { applyFilter } from './extensions';
import { startupMilestoneReached } from './lifecycle';
import { mochiEvents } from './events';
import { logger } from './utils/log';
import type { MochiCronJob, MochiCronRun } from './cron';

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

/**
 * A queue reference usable as a `deadLetter` target: any descriptor returned by `Mochi.queue()`. Non-generic so a
 * descriptor of any payload type fits.
 */
export interface MochiDeadLetterTarget {
  readonly __mochiQueue: true;
  readonly name: string;
  readonly options?: MochiQueueRuntimeOptions;
  readonly storage?: MochiQueueStorage;
}

/** The non-processor settings of a queue — what survives on `MochiQueueConfig.options`. */
export interface MochiQueueRuntimeOptions {
  /** Jobs of this queue processed in parallel in this process. */
  concurrency?: number;
  /** Seconds between idle fetches; must be >= 0.5. Adds from this process wake the worker immediately regardless. */
  pollingIntervalSeconds?: number;
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
  /**
   * Where terminally failed jobs move: another queue's descriptor (self-sufficient — the target is ensured before
   * this queue, from any process), or its name, which must be declared in the same queues array or already exist in storage.
   */
  deadLetter?: string | MochiDeadLetterTarget;
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
  /** Who started the runtime: serve owns workers; standalone is producer-only. */
  kind: 'serve' | 'standalone' | null;
  /** Storage the running boss was started with, for identity checks against later connect attempts. */
  storage: MochiQueueStorage | null;
  /** In-flight standalone boot, so concurrent first-adds share one `start()`. */
  starting: Promise<void> | null;
  /** Graceful drain budget (ms) for shutdown, from `queueShutdownTimeout`; see `closeAllQueueResources`. */
  shutdownTimeout: number;
  /** Dedicated cron boss when cron uses a store other than queueStorage; null when cron rides the queue boss or is unused. */
  cronBoss: BunBoss | null;
  /** SQL handle owned by a dedicated sqlite/memory cron boss, closed on shutdown. */
  cronOwnedSql: SQL | null;
}

const DEFAULT_QUEUE_SHUTDOWN_TIMEOUT = 10_000;

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
  shutdownTimeout: DEFAULT_QUEUE_SHUTDOWN_TIMEOUT,
  cronBoss: null,
  cronOwnedSql: null,
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

export const DEFAULT_EXPIRE_IN_SECONDS = queueOptionDefaults.expireInSeconds as number;

// The Mochi-managed subset of bun-boss's stored option defaults: declared code is authoritative and an undeclared
// option means "the default", so these are what it must read back as.
const QUEUE_OPTION_DEFAULTS = {
  retryLimit: queueOptionDefaults.retryLimit,
  retryDelay: queueOptionDefaults.retryDelay,
  retryBackoff: queueOptionDefaults.retryBackoff,
  retryDelayMax: queueOptionDefaults.retryDelayMax,
  expireInSeconds: queueOptionDefaults.expireInSeconds,
  retentionSeconds: queueOptionDefaults.retentionSeconds,
  deleteAfterSeconds: queueOptionDefaults.deleteAfterSeconds,
  deadLetter: queueOptionDefaults.deadLetter,
};
type ManagedQueueField = keyof typeof QUEUE_OPTION_DEFAULTS;
type ManagedQueueValue = number | boolean | string | null;

function isDeadLetterDescriptor(dl: string | MochiDeadLetterTarget | undefined): dl is MochiDeadLetterTarget {
  return typeof dl === 'object' && dl !== null && dl.__mochiQueue === true;
}

function deadLetterName(dl: string | MochiDeadLetterTarget | undefined): string | undefined {
  return typeof dl === 'string' ? dl : dl?.name;
}

/** `MOCHI_QUEUE_SYNC=1` exists for one-shot migration deploys, so it is process-wide and wins over the code option. */
export function resolveQueueConfigMode(declared?: 'verify' | 'sync'): 'verify' | 'sync' {
  const env = process.env.MOCHI_QUEUE_SYNC;
  return env === '1' || env === 'true' ? 'sync' : (declared ?? 'verify');
}

// The sqlite dialect can hand back 0/1 (or string) booleans and string-typed numerics; those must not read as drift.
function normalizeStoredValue(field: ManagedQueueField, value: unknown): ManagedQueueValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (field === 'deadLetter') {
    return String(value);
  }
  if (field === 'retryBackoff') {
    return Boolean(typeof value === 'string' ? Number(value) : value);
  }
  return Number(value);
}

interface QueueConfigDiff {
  field: ManagedQueueField;
  stored: ManagedQueueValue;
  declared: ManagedQueueValue;
}

function diffQueueConfig(expected: Record<ManagedQueueField, ManagedQueueValue>, stored: Record<string, unknown>): QueueConfigDiff[] {
  const diffs: QueueConfigDiff[] = [];
  for (const field of Object.keys(QUEUE_OPTION_DEFAULTS) as ManagedQueueField[]) {
    const storedValue = normalizeStoredValue(field, stored[field]);
    const declaredValue = expected[field] ?? null;
    if (!Object.is(storedValue, declaredValue)) {
      diffs.push({ field, stored: storedValue, declared: declaredValue });
    }
  }
  return diffs;
}

function formatQueueValue(value: ManagedQueueValue): string {
  if (value === null) {
    return 'unset';
  }
  return typeof value === 'string' ? `"${value}"` : String(value);
}

function queueConfigMismatchError(context: string, name: string, diffs: QueueConfigDiff[]): Error {
  const stored = diffs.map((d) => `${d.field} ${formatQueueValue(d.stored)}`).join(', ');
  const declared = diffs.map((d) => `${d.field} ${formatQueueValue(d.declared)}`).join(', ');
  const hint = diffs.map((d) => `${d.field}: ${typeof d.declared === 'string' ? `"${d.declared}"` : String(d.declared)}`).join(', ');
  return new Error(
    `${context}: "${name}" already exists in storage with ${stored}, but this code declares ${declared}. Code is authoritative for queue config — update the declaration to match, migrate the store with Mochi.boss().updateQueue("${name}", { ${hint} }) and restart, or boot once with MOCHI_QUEUE_SYNC=1 (or queueConfig: 'sync') to apply the declared config.`,
  );
}

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
  const { retryLimit, retryDelay, retryBackoff, retryDelayMax, retentionSeconds, deleteAfterSeconds } = options ?? {};
  return omitUndefined({
    expireInSeconds,
    retryLimit,
    retryDelay,
    retryBackoff,
    retryDelayMax,
    retentionSeconds,
    deleteAfterSeconds,
    deadLetter: deadLetterName(options?.deadLetter),
  });
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
      // Serve adopts a standalone producer runtime on the same storage; mountQueues then layers workers and its own
      // config verification on top of it. Producer handles reset so only queues the serve declares stay producible —
      // otherwise whether an undeclared queue can produce would depend on whether it raced the boot.
      registry.kind = 'serve';
      registry.byName.clear();
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

// bun-boss's large-backlog warning ("large queue backlog…") names the offending queue and its depth in
// `warning.data`, but bakes neither into `warning.message`; fold the queued count in so the log line says
// how big the backlog actually is. Other warnings (slow query, clock skew, notifier) carry no such fields
// and pass through untouched.
export function formatQueueWarning(warning: Warning): string {
  const data = warning.data as { name?: unknown; queuedCount?: unknown };
  const queuedCount = Number(data?.queuedCount);
  if (typeof data?.name === 'string' && Number.isFinite(queuedCount)) {
    return `${warning.message} (queue "${data.name}" has ${queuedCount} job${queuedCount === 1 ? '' : 's'} queued)`;
  }
  return warning.message;
}

interface ConstructBossOptions {
  /** Schema for postgres/pglite; ignored by the sqlite backend, which has no schemas. */
  schema: string;
  /** Enable bun-boss's durable cron timekeeper on this instance. */
  schedule: boolean;
  enableSpies: boolean;
  /** How often the timekeeper checks whether a schedule is due; low values let tests fire quickly. */
  cronMonitorIntervalSeconds?: number;
  /** How often the internal send-it worker forwards a due schedule to its queue (test hook). */
  cronWorkerIntervalSeconds?: number;
}

/** Construct (but do not start) a BunBoss for a storage, plus the SQL handle it owns for sqlite/memory. */
function constructBoss(storage: MochiQueueStorage, opts: ConstructBossOptions): { boss: BunBoss; ownedSql: SQL | null } {
  const extra = {
    schedule: opts.schedule,
    ...(opts.enableSpies ? { __test__enableSpies: true } : {}),
    ...(opts.cronMonitorIntervalSeconds ? { cronMonitorIntervalSeconds: opts.cronMonitorIntervalSeconds } : {}),
    ...(opts.cronWorkerIntervalSeconds ? { cronWorkerIntervalSeconds: opts.cronWorkerIntervalSeconds } : {}),
  };
  if (storage === 'memory' || 'sqlite' in storage) {
    const file = storage === 'memory' ? ':memory:' : storage.sqlite;
    if (file !== ':memory:') {
      mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    }
    const sql = new SQL(`sqlite://${file}`);
    return { boss: new BunBoss({ backend: 'sqlite', db: fromBunSqlite(sql), ...extra }), ownedSql: sql };
  }
  if ('pglite' in storage) {
    // The caller constructs and owns the PGlite instance (bun-boss's adapter contract), so nothing is owned for closing.
    return { boss: new BunBoss({ backend: 'pglite', db: fromPglite(storage.pglite), schema: opts.schema, ...extra }), ownedSql: null };
  }
  return { boss: new BunBoss({ url: storage.postgres, backend: 'postgres', schema: opts.schema, ...extra }), ownedSql: null };
}

/** Wire error/warning logging before start(): an 'error' emit with no listener kills the process (EventEmitter semantics). */
function attachBossLogging(boss: BunBoss, label: string): void {
  boss.on('error', (error) => {
    logger.error(`[${label}] ${error.message}`);
    mochiEvents.emit('queue:error', { error: error.message });
  });
  boss.on('warning', (warning) => {
    logger.warn(`[${label}] ${formatQueueWarning(warning)}`);
  });
}

async function bootQueueRuntime(storage: MochiQueueStorage, kind: 'serve' | 'standalone', enableSpies: boolean): Promise<void> {
  // Queues never schedule; durable cron always runs on its own bun-boss instance (see startCronRuntime).
  const { boss, ownedSql } = constructBoss(storage, { schema: 'mochi_queue', schedule: false, enableSpies });
  // Registered before start() so the failure path in Mochi.serve (closeAllQueueResources) closes it too.
  registry.ownedSql = ownedSql;
  attachBossLogging(boss, 'queue');
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

function makeHandler<T, R>(name: string, process: MochiProcessor<T, R>, listeners?: Partial<MochiQueueListeners<T, R>>) {
  // The worker is pinned to batchSize 1, so the array bun-boss hands over holds one job; jobs settle via
  // `perJobResults`, which keeps raw Error outputs (name/stack/cause) intact in the durable store.
  return async (batch: JobWithMetadata<T>[]): Promise<JobResult[]> => {
    const results: JobResult[] = [];
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
      notifySafely(name, () => mochiEvents.emit('queue:active', { queue: name, jobId: job.id, attempt: job.attempt }));
      notifySafely(name, () => listeners?.active?.(job));
      try {
        const result = await process(job);
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
 * Make a descriptor's producer methods callable: a no-op when the queue is already mounted, otherwise the lazy
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
  await verifyOrCreateQueues([descriptor], `Mochi.queue("${name}")`, resolveQueueConfigMode());
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
  // The runtime is shared, so it closes only when the last active queue lets go.
  if (registry.byName.size === 0) {
    await closeAllQueueResources();
  }
}

interface DeclaredQueueEntry {
  name: string;
  bossOptions: UpdateQueueOptions;
  storage?: MochiQueueStorage;
}

function declarationKey(bossOptions: UpdateQueueOptions): string {
  return JSON.stringify(Object.fromEntries(Object.entries(bossOptions).sort(([a], [b]) => (a < b ? -1 : 1))));
}

/**
 * Resolve the declared queues plus every descriptor-form deadLetter target, recursively — the closure is what lets a
 * lone producer create its queue with the link intact (the target is known and ensured first). Also validates
 * self-references and conflicting duplicate declarations. Pure, so the serve prelude can check the same graph
 * pre-bind (the dup check compares filter-shaped options, but both sides pass through the same filter, so its verdict
 * is the same whether or not extensions are initialized yet).
 */
export function collectQueueClosure(queues: MountableQueue[], context: string): DeclaredQueueEntry[] {
  const entries = new Map<string, DeclaredQueueEntry>();
  const pending: Array<{ q: MountableQueue; referrer?: string }> = queues.map((q) => ({ q }));
  while (pending.length > 0) {
    const { q, referrer } = pending.shift()!;
    const bossOptions = toBossQueueOptions(q.name, q.options);
    const existing = entries.get(q.name);
    if (existing) {
      if (declarationKey(existing.bossOptions) !== declarationKey(bossOptions)) {
        throw new Error(
          `${context}: "${q.name}" is declared twice with different options${referrer ? ` — once directly and once as "${referrer}"'s deadLetter descriptor` : ''}. Share one descriptor.`,
        );
      }
      continue;
    }
    entries.set(q.name, { name: q.name, bossOptions, storage: q.storage });
    const dl = q.options?.deadLetter;
    if (deadLetterName(dl) === q.name) {
      throw new Error(`${context}: "${q.name}" names itself as its deadLetter queue.`);
    }
    if (isDeadLetterDescriptor(dl)) {
      pending.push({ q: { name: dl.name, options: dl.options, storage: dl.storage }, referrer: q.name });
    }
  }
  return [...entries.values()];
}

// Order the queues so each deadLetter target comes before the queue pointing at it, since createQueue needs the target
// to already exist. A target outside the closure is external — its referrer orders freely and the FK decides at create
// time. Leftovers point in a loop (A→B→A), which cannot be built from scratch; the caller verifies those against storage.
function orderByDeadLetter(items: DeclaredQueueEntry[]): { ordered: DeclaredQueueEntry[]; cyclic: DeclaredQueueEntry[] } {
  const names = new Set(items.map((item) => item.name));
  const ordered: DeclaredQueueEntry[] = [];
  const emitted = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const item of items) {
      if (emitted.has(item.name)) {
        continue;
      }
      const target = item.bossOptions.deadLetter;
      if (target == null || !names.has(target) || emitted.has(target)) {
        ordered.push(item);
        emitted.add(item.name);
        progressed = true;
      }
    }
  }
  return { ordered, cyclic: items.filter((item) => !emitted.has(item.name)) };
}

/**
 * The one rule for every path (serve, worker, standalone producer): create each declared queue with its full config,
 * read it back, and require storage to match the declaration — code is authoritative, storage is a cache of it.
 * A declaration with no persisted options is a pure existence reference and skips the comparison.
 */
async function verifyOrCreateQueues(queues: MountableQueue[], context: string, mode: 'verify' | 'sync'): Promise<void> {
  const boss = requireBoss();
  const entries = collectQueueClosure(queues, context);
  const { ordered, cyclic } = orderByDeadLetter(entries);
  if (cyclic.length > 0) {
    const rows = await Promise.all(cyclic.map((item) => boss.getQueue(item.name)));
    if (rows.some((row) => row == null)) {
      throw new Error(
        `${context}: deadLetter loop among ${cyclic.map((item) => `"${item.name}"`).join(', ')} — these queues do not all exist in storage yet, and a loop cannot be created from scratch (each deadLetter target must exist before its referrer). Create them once via Mochi.boss().createQueue()/updateQueue(); an existing loop that matches the declaration passes.`,
      );
    }
    // Every member exists, so createQueue is a no-op and only the verification below runs.
    ordered.push(...cyclic);
  }
  // Idempotent per queue (createQueue is ON CONFLICT DO NOTHING, verification is a read), so no memoization: a queue
  // reached twice — a shared deadLetter target, a redundant boot — just re-verifies.
  for (const entry of ordered) {
    await verifyOrCreateQueue(boss, entry, context, mode);
  }
}

async function verifyOrCreateQueue(boss: BunBoss, entry: DeclaredQueueEntry, context: string, mode: 'verify' | 'sync'): Promise<void> {
  const { name, bossOptions } = entry;
  if (entry.storage !== undefined && !storageEquals(registry.storage, entry.storage)) {
    throw storageMismatchError(name, entry.storage);
  }
  try {
    await boss.createQueue(name, bossOptions);
  } catch (err) {
    const target = bossOptions.deadLetter;
    if (target != null && (await boss.getQueue(target).catch(() => null)) == null) {
      throw new Error(
        `${context}: "${name}" names "${target}" as its deadLetter queue, but "${target}" is not declared here and does not exist in storage, so "${name}" cannot be created with its link. Pass the target's descriptor — deadLetter: Mochi.queue("${target}", …) — so it is ensured first.`,
        { cause: err },
      );
    }
    throw err;
  }
  if (Object.keys(bossOptions).length === 0) {
    return;
  }
  const stored = await boss.getQueue(name);
  if (!stored) {
    throw new Error(`${context}: could not read back queue "${name}" after creating it.`);
  }
  const expected = { ...QUEUE_OPTION_DEFAULTS, ...bossOptions } as Record<ManagedQueueField, ManagedQueueValue>;
  const diffs = diffQueueConfig(expected, stored as unknown as Record<string, unknown>);
  if (diffs.length === 0) {
    return;
  }
  if (mode === 'verify') {
    throw queueConfigMismatchError(context, name, diffs);
  }
  // Full-field write, nulls included: concrete values defeat COALESCE staleness, and the nullable fields
  // (deadLetter, retryDelayMax) apply by key presence, so a null clears them.
  await boss.updateQueue(name, expected as UpdateQueueOptions);
  const reread = await boss.getQueue(name);
  const remaining = reread == null ? diffs : diffQueueConfig(expected, reread as unknown as Record<string, unknown>);
  if (remaining.length > 0) {
    throw queueConfigMismatchError(context, name, remaining);
  }
  logger.warn(
    `[queue] "${name}": synced stored config to the declaration — ${diffs.map((d) => `${d.field} ${formatQueueValue(d.stored)} → ${formatQueueValue(d.declared)}`).join(', ')}.`,
  );
}

// Durable cron runs on its own bun-boss instance keyed by this schema/table-prefix, so it never touches the queue
// tables even when pointed at the same store. Each cron becomes a queue named `cron-<name>`, reserving that prefix.
const CRON_SCHEMA = 'mochi_cron';
export const CRON_QUEUE_PREFIX = 'cron-';
/** Fixed startup jitter (ms): a random 0..N delay staggers the timekeeper poll across nodes; not user-configurable. */
export const CRON_JITTER_MS = 3000;

const cronQueueName = (name: string): string => `${CRON_QUEUE_PREFIX}${name}`;

export interface StartCronOptions {
  cronStorage: MochiQueueStorage;
  development: boolean;
  /** Random 0..jitterMs delay before the scheduler starts; pass 0 in dev/tests. */
  jitterMs: number;
  enableSpies?: boolean;
  /** Test hooks: low intervals let a `* * * * *` schedule fire within seconds instead of up to a minute. */
  cronMonitorIntervalSeconds?: number;
  cronWorkerIntervalSeconds?: number;
  workerPollingSeconds?: number;
}

function cronRunFrom(job: MochiCronJob): MochiCronRun {
  return { name: job.name, schedule: job.schedule, scheduledTime: Date.now(), ...(job.options?.tz ? { tz: job.options.tz } : {}) };
}

// A durable cron run is a queue job named `cron-<name>`, so reuse makeHandler — the run then emits
// queue:active/completed/failed under that queue name, and a throw is failed-and-logged, not process-fatal.
function cronWorkHandler(job: MochiCronJob) {
  return makeHandler<unknown, void>(cronQueueName(job.name), async () => {
    await job.run(cronRunFrom(job));
  });
}

/** Stop the dedicated cron boss (if any) and release its SQL handle; idempotent, and schedules stay in the store. */
export async function stopCronRuntime(): Promise<void> {
  const { cronBoss, cronOwnedSql, shutdownTimeout } = registry;
  registry.cronBoss = null;
  registry.cronOwnedSql = null;
  if (cronBoss) {
    try {
      await cronBoss.stop({ graceful: true, timeout: shutdownTimeout });
    } catch (err) {
      logger.warn(`[cron] shutdown: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (cronOwnedSql) {
    try {
      await cronOwnedSql.close();
    } catch {
      // Already closed by a failed start; nothing to do.
    }
  }
}

/**
 * Register durable schedules on a dedicated bun-boss instance; the single winner per tick is elected atomically in the
 * database, so exactly one node enqueues each firing. Skipped during a build; re-running replaces any prior cron boss so
 * the dev watcher can re-register when the cron array changes.
 */
export async function startCronRuntime(jobs: MochiCronJob[], opts: StartCronOptions): Promise<void> {
  if (isBuildingEntry()) {
    return;
  }
  await stopCronRuntime();
  const active = jobs.filter((job) => !(opts.development && job.options?.dev === false));

  if (opts.jitterMs > 0) {
    await Bun.sleep(Math.floor(Math.random() * opts.jitterMs));
  }
  const { boss, ownedSql } = constructBoss(opts.cronStorage, {
    schema: CRON_SCHEMA,
    schedule: true,
    enableSpies: opts.enableSpies ?? false,
    cronMonitorIntervalSeconds: opts.cronMonitorIntervalSeconds,
    cronWorkerIntervalSeconds: opts.cronWorkerIntervalSeconds,
  });
  attachBossLogging(boss, 'cron');
  try {
    await boss.start();
  } catch (err) {
    await boss.stop({ graceful: false }).catch(() => {});
    if (ownedSql) {
      await ownedSql.close().catch(() => {});
    }
    throw err;
  }
  registry.cronBoss = boss;
  registry.cronOwnedSql = ownedSql;

  // Reconcile: drop any schedule this runtime owns that is no longer declared (a removed Mochi.cron line, or a
  // dev-skipped job) so an orphaned schedule can't keep enqueuing jobs no worker consumes.
  const declaredQueues = new Set(active.map((job) => cronQueueName(job.name)));
  for (const schedule of await boss.getSchedules()) {
    if (!declaredQueues.has(schedule.name)) {
      await boss.unschedule(schedule.name);
    }
  }

  const cronWorkOptions = {
    batchSize: 1,
    includeMetadata: true,
    perJobResults: true,
    ...(opts.workerPollingSeconds ? { pollingIntervalSeconds: opts.workerPollingSeconds } : {}),
  } as WorkOptions & { includeMetadata: true; perJobResults: true };

  for (const job of active) {
    const queueName = cronQueueName(job.name);
    await boss.createQueue(queueName); // idempotent (ON CONFLICT DO NOTHING); config-preserving on an existing queue.
    await boss.work(queueName, cronWorkOptions, cronWorkHandler(job));
    await boss.schedule(queueName, job.schedule, {}, job.options?.tz ? { tz: job.options.tz } : undefined);
    const next = job.nextRun();
    mochiEvents.emit('cron:scheduled', {
      job: job.name,
      schedule: job.schedule,
      ...(job.options?.tz ? { tz: job.options.tz } : {}),
      ...(next === null ? {} : { nextRun: next }),
    });
  }
}

/** Logical names (prefix stripped) of the durable cron jobs registered in this process. */
export async function registeredCronNames(): Promise<string[]> {
  const boss = registry.cronBoss;
  if (!boss) {
    return [];
  }
  return (await boss.getSchedules()).map((schedule) => schedule.name.slice(CRON_QUEUE_PREFIX.length));
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
      if (isBuildingEntry()) {
        return null;
      }
      await ensureUsable(descriptor);
      return base.add(data, opts);
    },
    async addBulk(jobs) {
      if (isBuildingEntry()) {
        return [];
      }
      await ensureUsable(descriptor);
      return base.addBulk(jobs);
    },
    async addThrottled(data, seconds, key, opts) {
      if (isBuildingEntry()) {
        return null;
      }
      await ensureUsable(descriptor);
      return base.addThrottled(data, seconds, key, opts);
    },
    async addDebounced(data, seconds, key, opts) {
      if (isBuildingEntry()) {
        return null;
      }
      await ensureUsable(descriptor);
      return base.addDebounced(data, seconds, key, opts);
    },
    async stop() {
      if (isBuildingEntry()) {
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
export async function mountQueues(queues: MountableQueue[], mode: 'verify' | 'sync' = 'verify', shutdownTimeout: number = DEFAULT_QUEUE_SHUTDOWN_TIMEOUT): Promise<void> {
  const boss = requireBoss();
  registry.shutdownTimeout = shutdownTimeout;
  await verifyOrCreateQueues(queues, 'Mochi.serve({ queues })', mode);
  // Only the declared array is registered — implicit descriptor-form deadLetter targets are ensured, not mounted.
  for (const config of queues) {
    registry.byName.set(config.name, producerMethods(config.name));
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
  const workOptions = omitUndefined({
    // Escape hatch first; Mochi-owned keys below win where they overlap.
    ...omitUndefined({ ...(o?.worker ?? {}) }),
    batchSize: 1,
    includeMetadata: true,
    perJobResults: true,
    localConcurrency: o?.concurrency,
    pollingIntervalSeconds: o?.pollingIntervalSeconds,
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
export function createWorker(
  queues: MountableQueue[],
  storage?: MochiQueueStorage,
  queueConfig?: 'verify' | 'sync',
  shutdownTimeout: number = DEFAULT_QUEUE_SHUTDOWN_TIMEOUT,
): MochiWorker {
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
      if (isBuildingEntry()) {
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
        registry.shutdownTimeout = shutdownTimeout;
        await verifyOrCreateQueues(queues, 'Mochi.worker()', resolveQueueConfigMode(queueConfig));
        for (const q of queues) {
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
  const { boss, ownedSql, shutdownTimeout } = registry;
  // Cleared first so a fresh serve in this process (e.g. a test that restarts) can re-mount its queues even if a
  // close below fails.
  registry.boss = null;
  registry.ownedSql = null;
  registry.kind = null;
  registry.storage = null;
  registry.starting = null;
  registry.byName.clear();
  registry.workIds.clear();
  registry.shutdownTimeout = DEFAULT_QUEUE_SHUTDOWN_TIMEOUT;
  if (boss) {
    try {
      // bun-boss drains in-flight handlers within the graceful window and settles their cleanups before closing
      // the store; a job still running when the window lapses is failed and follows its retry policy. Raising
      // `queueShutdownTimeout` above the job duration lets it finish instead of being re-run.
      await boss.stop({ graceful: true, timeout: shutdownTimeout });
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
  await stopCronRuntime();
}
