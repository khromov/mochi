// The isolation boundary around queuert: the only module importing `queuert`'s factories, and (with the two provider
// bridges in `jobs/`) the only one whose rewrite a backend swap would need.
import { createClient, createInProcessNotifyAdapter, createInProcessStateAdapter, createInProcessWorker, createProcessors, withTransactionHooks } from 'queuert';
import type {
  BackoffConfig,
  BaseJobTypeDefinitions,
  Chain,
  Client,
  DeduplicationOptions,
  InProcessWorkerProcessor,
  JobTypeEntryNames,
  JobTypeNames,
  JobTypeProperty,
  JobTypes,
  JobTypesDefinitions,
  Log,
  NotifyAdapter,
  ObservabilityAdapter,
  ResolvedChain,
  ScheduleOptions,
  StateAdapter,
  TransactionHooks,
} from 'queuert';
import { createAsyncRwLock, createSqliteStateAdapter } from '@queuert/sqlite';
import { createPgStateAdapter } from '@queuert/postgres';
import { Database } from 'bun:sqlite';
import { SQL } from 'bun';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { pinGlobal } from './utils/globalState';
import { applyFilter } from './extensions';
import { startupMilestoneReached } from './lifecycle';
import { mochiEvents } from './events';
import { logger } from './utils/log';
import { createBunSqliteStateProvider } from './jobs/sqliteProvider';
import { createBunSqlStateProvider } from './jobs/postgresProvider';

/** In-process notify wakes same-process workers instantly; polling only covers other instances, so it can stay tight. */
export const DEFAULT_JOBS_POLL_INTERVAL_MS = 2_000;

/** queuert's own default; leases auto-renew while an attempt runs, so a long job never needs a longer lease. */
export const DEFAULT_JOBS_LEASE_MS = 60_000;

/**
 * Where job state lives. `memory` vanishes on restart; `sqlite`/`postgres` are durable and let `startChain` commit in
 * the same transaction as your own writes when you share the `database`/`sql` handle with your app.
 */
export type MochiJobsBackend = { kind: 'memory' } | { kind: 'sqlite'; path?: string; database?: Database } | { kind: 'postgres'; url?: string; sql?: SQL };

/**
 * Escape hatches forwarded verbatim to the underlying queuert factories; each object is spread last, so it overrides
 * whatever Mochi derived. `notifyAdapter`/`observabilityAdapter` take full adapter instances (e.g. a real pg
 * LISTEN/NOTIFY adapter, or `@queuert/otel`). A `log` inside `client` composes with — rather than replaces — the log
 * Mochi installs for `queue:*` events.
 */
export interface MochiJobsQueuertEscapes {
  client?: Record<string, unknown>;
  worker?: Record<string, unknown>;
  stateAdapter?: Record<string, unknown>;
  notifyAdapter?: NotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
}

/** The erased adapter shape processors are typed against; the concrete backend is only known at mount. */
type ErasedStateAdapter = StateAdapter<Record<string, unknown>, string>;

/** One processor per job type: `{ attemptHandler, backoffConfig?, leaseConfig? }`, typed against the registry. */
export type MochiJobProcessors<TDefs extends BaseJobTypeDefinitions> = {
  [K in JobTypeNames<TDefs>]: InProcessWorkerProcessor<ErasedStateAdapter, TDefs, K, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
};

/** The full config object passed to `Mochi.jobs({ types, processors, … })`. */
export interface MochiJobsOptions<TTypes extends JobTypes<BaseJobTypeDefinitions>> {
  /** The result of `defineJobTypes<…>()`. */
  types: TTypes;
  processors: MochiJobProcessors<JobTypesDefinitions<TTypes>>;
  /** Defaults to `{ kind: 'memory' }`. */
  backend?: MochiJobsBackend;
  /** Max jobs processed in parallel. Defaults to queuert's 1. */
  concurrency?: number;
  /** Cross-instance pickup latency for durable backends — same-process enqueues wake the worker instantly. */
  pollIntervalMs?: number;
  workerName?: string;
  /**
   * Default backoff between failed attempts, overridable per processor. queuert retries a throwing handler
   * indefinitely — a job type that should give up completes with a failure-shaped output once `job.attempt` crosses its
   * own threshold.
   */
  retry?: BackoffConfig;
  /** How long an attempt may go unrenewed before another worker may reclaim the job. */
  leaseMs?: number;
  queuert?: MochiJobsQueuertEscapes;
}

/** Options for `jobs.startChain()`. Pass `tx` + `transactionHooks` (from `jobs.withTransaction`) to commit the chain atomically with your own writes; omit both and Mochi runs the enqueue in its own transaction. */
export type MochiStartChainOptions<TDefs extends BaseJobTypeDefinitions, TName extends JobTypeEntryNames<TDefs>> = {
  typeName: TName;
  input: JobTypeProperty<TDefs, TName, 'input'>;
  id?: string;
  deduplication?: DeduplicationOptions<string>;
  schedule?: ScheduleOptions;
  /** Chains this one must wait for. Loosely typed here — drop to `jobs.client()` for fully inferred blockers. */
  blockers?: readonly Chain<string, string, unknown, unknown>[];
  tx?: Record<string, unknown>;
  transactionHooks?: TransactionHooks;
};

export interface MochiJobsTransactionContext {
  /** Adapter-specific transaction context (sqlite: `{ db }`, postgres: `{ sql }`); forward it to `startChain`. */
  tx: Record<string, unknown>;
  transactionHooks: TransactionHooks;
}

/** The typed handle returned by `Mochi.jobs()` — inert until `Mochi.serve({ jobs })` mounts it. */
export interface MochiJobs<TDefs extends BaseJobTypeDefinitions> {
  startChain<TName extends JobTypeEntryNames<TDefs>>(options: MochiStartChainOptions<TDefs, TName>): Promise<ResolvedChain<string, TDefs, TName> & { deduplicated: boolean }>;
  awaitChain<TName extends JobTypeEntryNames<TDefs> = JobTypeEntryNames<TDefs>>(
    chain: { id: string; typeName?: TName },
    options?: { timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal },
  ): Promise<ResolvedChain<string, TDefs, TName> & { status: 'completed' }>;
  /**
   * Open a transaction on the jobs backend and run `fn` inside it. Statements issued on the same shared
   * `database`/`sql` handle join it automatically, so a domain write plus a `startChain({ …, ...ctx })` commit or roll
   * back together.
   */
  withTransaction<T>(fn: (ctx: MochiJobsTransactionContext) => Promise<T>): Promise<T>;
  /** The raw queuert client, fully typed — `completeChain`, `listChains`, `rescheduleJob`, blockers and all. */
  client(): Client<TDefs, ErasedStateAdapter>;
}

/** Inert marker `Mochi.serve({ jobs })` validates before mounting. */
export interface MochiJobsConfig {
  readonly __mochiJobs: true;
}

export function isMochiJobs(value: unknown): value is MochiJobsConfig {
  return typeof value === 'object' && value !== null && (value as MochiJobsConfig).__mochiJobs === true;
}

/** What the descriptor actually carries; hidden behind `MochiJobsConfig` so `MochiServeOptions` stays non-generic. */
interface JobsDescriptorInternal extends MochiJobsConfig {
  readonly mochiOptions: MochiJobsOptions<JobTypes<BaseJobTypeDefinitions>>;
}

type ErasedClient = Client<BaseJobTypeDefinitions, ErasedStateAdapter>;

interface JobsRuntime {
  descriptor: MochiJobsConfig;
  client: ErasedClient;
  stateAdapter: ErasedStateAdapter;
  stopWorker: () => Promise<void>;
  notifyAdapter: NotifyAdapter;
  /** Whether Mochi created the notify adapter (and so owns closing it). */
  ownedNotify: boolean;
  /** Backend resources Mochi opened itself — never caller-supplied handles. */
  ownedDb?: Database;
  ownedSql?: SQL;
}

interface JobsRegistry {
  runtime: JobsRuntime | null;
}

// Pinned so every duplicate bundled copy of this module shares one registry — `closeAllJobResources` must see the
// runtime whichever copy created it.
const registry = pinGlobal<JobsRegistry>('__mochi_jobs_registry__', () => ({ runtime: null }));

function runtimeFor(descriptor: MochiJobsConfig): JobsRuntime {
  const runtime = registry.runtime;
  if (!runtime) {
    // Two different mistakes, two different answers, told apart by the recorded startup milestone.
    if (!startupMilestoneReached('mochi:jobsMounted')) {
      throw new Error(
        'Mochi.jobs: not mounted yet. Mochi.serve({ jobs }) mounts the runtime after the server binds, so call startChain()/awaitChain() somewhere that runs later: the "mochi:ready" hook, or any request handler.',
      );
    }
    throw new Error('Mochi.jobs: Mochi.serve() ran without a `jobs` option. Pass this descriptor via Mochi.serve({ jobs }).');
  }
  if (runtime.descriptor !== descriptor) {
    throw new Error(
      'Mochi.jobs: this descriptor is not the one Mochi.serve({ jobs }) mounted. Only one jobs runtime exists per process — share the mounted descriptor instead of creating a second.',
    );
  }
  return runtime;
}

/** The type-erased shape every `startChain` call funnels through; the descriptor's generics enforce the real contract. */
type ErasedStartChainOptions = {
  typeName: string;
  input: unknown;
  id?: string;
  deduplication?: DeduplicationOptions<string>;
  schedule?: ScheduleOptions;
  blockers?: readonly Chain<string, string, unknown, unknown>[];
  tx?: Record<string, unknown>;
  transactionHooks?: TransactionHooks;
};

function startChainThrough(runtime: JobsRuntime, options: ErasedStartChainOptions): Promise<Chain<string, string, unknown, unknown> & { deduplicated: boolean }> {
  const { tx, transactionHooks, ...rest } = options;
  const client = runtime.client as unknown as {
    startChain: (opts: Record<string, unknown>) => Promise<Chain<string, string, unknown, unknown> & { deduplicated: boolean }>;
  };
  if ((tx === undefined) !== (transactionHooks === undefined)) {
    throw new Error('Mochi.jobs.startChain: pass `tx` and `transactionHooks` together (both from jobs.withTransaction()) or neither.');
  }
  if (tx && transactionHooks) {
    return client.startChain({ ...rest, transactionHooks, ...tx });
  }
  return withTransactionHooks(async (hooks) => runtime.stateAdapter.withTransaction(async (txCtx) => client.startChain({ ...rest, transactionHooks: hooks, ...txCtx })));
}

function buildHandle(descriptor: MochiJobsConfig): MochiJobs<BaseJobTypeDefinitions> {
  // Async wrappers so a pre-mount call surfaces as a rejection, matching how callers consume these methods.
  return {
    async startChain(options) {
      return (await startChainThrough(runtimeFor(descriptor), options as unknown as ErasedStartChainOptions)) as never;
    },
    async awaitChain(chain, options) {
      const runtime = runtimeFor(descriptor);
      return (await runtime.client.awaitChain(chain as { id: string }, { timeoutMs: 30_000, ...options })) as never;
    },
    async withTransaction(fn) {
      const runtime = runtimeFor(descriptor);
      return withTransactionHooks(async (transactionHooks) => runtime.stateAdapter.withTransaction(async (tx) => fn({ tx, transactionHooks })));
    },
    client() {
      return runtimeFor(descriptor).client as never;
    },
  };
}

/**
 * Declare the app's background jobs. Like `page`/`api`/`ws`/`sse` this returns an inert descriptor; the live queuert
 * client + worker are created only once `Mochi.serve({ jobs })` mounts it. The descriptor doubles as the typed handle —
 * export it from the declaring module and call `startChain` on it from anywhere server-side.
 */
export function createJobsDescriptor<const TTypes extends JobTypes<BaseJobTypeDefinitions>>(
  options: MochiJobsOptions<TTypes>,
): MochiJobs<JobTypesDefinitions<TTypes>> & MochiJobsConfig {
  const descriptor = {
    __mochiJobs: true as const,
    mochiOptions: options as MochiJobsOptions<JobTypes<BaseJobTypeDefinitions>>,
  } satisfies JobsDescriptorInternal;
  return Object.assign(descriptor, buildHandle(descriptor)) as never;
}

/** Resolve the mounted handle without the descriptor in scope — untyped; prefer importing the descriptor. */
export function getJobs<TDefs extends BaseJobTypeDefinitions = BaseJobTypeDefinitions>(): MochiJobs<TDefs> {
  const runtime = registry.runtime;
  if (!runtime) {
    // runtimeFor inside the handle throws the milestone-aware error on first use.
    return buildHandle({ __mochiJobs: true }) as never;
  }
  return buildHandle(runtime.descriptor) as never;
}

/** Maps queuert's structured log onto Mochi's five `queue:*` events, with `queue` = chain type and `jobName` = job type. */
function buildJobsLog(userLog: Log | undefined): Log {
  // queuert's log carries no durations, so attempts are timed here; entries clear on completed/failed and the map stays
  // bounded by in-flight attempts.
  const startedAt = new Map<string, number>();
  const durationFor = (jobId: string): number => {
    const start = startedAt.get(jobId);
    startedAt.delete(jobId);
    return start === undefined ? 0 : performance.now() - start;
  };
  return (entry) => {
    const data = entry.data as Record<string, unknown>;
    const jobId = typeof data.id === 'string' ? data.id : '';
    const jobName = typeof data.typeName === 'string' ? data.typeName : '';
    const queue = typeof data.chainTypeName === 'string' ? data.chainTypeName : jobName;
    const attempt = typeof data.attempt === 'number' ? data.attempt : 0;
    const entryError = (entry as { error?: unknown }).error;
    switch (entry.type) {
      case 'job_created':
        mochiEvents.emit('queue:added', { queue, jobId, jobName });
        break;
      case 'job_attempt_started':
        startedAt.set(jobId, performance.now());
        mochiEvents.emit('queue:active', { queue, jobId, jobName, attempt });
        break;
      case 'job_attempt_completed':
        mochiEvents.emit('queue:completed', { queue, jobId, jobName, attempt, duration: durationFor(jobId) });
        break;
      case 'job_attempt_failed': {
        const error = entryError instanceof Error ? entryError.message : String(entryError);
        mochiEvents.emit('queue:failed', { queue, jobId, jobName, attempt, duration: durationFor(jobId), error });
        break;
      }
      default:
        if (entry.level === 'error') {
          const error = entryError instanceof Error ? entryError.message : entryError === undefined ? entry.message : String(entryError);
          mochiEvents.emit('queue:error', { queue: queue || 'jobs', error });
        } else if (entry.level === 'warn') {
          logger.warn(`[jobs] ${entry.message}${jobName ? ` (${queue}/${jobName} ${jobId})` : ''}`);
        }
    }
    userLog?.(entry);
  };
}

/** Enforce the pragmas `migrateToLatest()` checks; `auto_vacuum` only takes effect after a VACUUM on a pre-existing file. */
function ensureSqlitePragmas(db: Database): void {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  const mode = db.query<{ auto_vacuum: number }, []>('PRAGMA auto_vacuum').get();
  if (mode?.auto_vacuum !== 2) {
    db.run('PRAGMA auto_vacuum = INCREMENTAL');
    db.run('VACUUM');
  }
}

interface BuiltStateAdapter {
  stateAdapter: ErasedStateAdapter;
  ownedDb?: Database;
  ownedSql?: SQL;
}

async function buildStateAdapter(backend: MochiJobsBackend, escapes: Record<string, unknown>): Promise<BuiltStateAdapter> {
  switch (backend.kind) {
    case 'memory': {
      const stateAdapter = await createInProcessStateAdapter({ ...escapes });
      return { stateAdapter: stateAdapter as never };
    }
    case 'sqlite': {
      let db = backend.database;
      let ownedDb: Database | undefined;
      if (!db) {
        if (!backend.path) {
          throw new Error("Mochi.jobs: the sqlite backend needs a `path` or an existing `database` handle — { backend: { kind: 'sqlite', path: 'data/jobs.sqlite' } }.");
        }
        // bun:sqlite won't create the parent directory itself.
        mkdirSync(path.dirname(backend.path), { recursive: true });
        db = ownedDb = new Database(backend.path, { create: true });
      }
      ensureSqlitePragmas(db);
      const stateProvider = createBunSqliteStateProvider({ db, lock: createAsyncRwLock() });
      const stateAdapter = await createSqliteStateAdapter({ stateProvider, ...escapes });
      await stateAdapter.migrateToLatest();
      const built: BuiltStateAdapter = { stateAdapter: stateAdapter as never };
      if (ownedDb) {
        built.ownedDb = ownedDb;
      }
      return built;
    }
    case 'postgres': {
      let sql = backend.sql;
      let ownedSql: SQL | undefined;
      if (!sql) {
        // Bun's SQL falls back to DATABASE_URL and friends when constructed without a url.
        sql = ownedSql = backend.url ? new SQL(backend.url) : new SQL();
      }
      const stateProvider = createBunSqlStateProvider({ sql });
      const stateAdapter = await createPgStateAdapter({ stateProvider, ...escapes });
      await stateAdapter.migrateToLatest();
      const built: BuiltStateAdapter = { stateAdapter: stateAdapter as never };
      if (ownedSql) {
        built.ownedSql = ownedSql;
      }
      return built;
    }
  }
}

/**
 * Boot the queuert runtime for a `Mochi.jobs()` descriptor: state adapter (+ migrations), notify adapter, client,
 * processors, and a started worker. Called only by `Mochi.serve`, after the server binds. Returns the job type names
 * for the `mochi:jobsMounted` hook.
 */
export async function mountJobs(config: MochiJobsConfig): Promise<string[]> {
  if (registry.runtime) {
    throw new Error('Mochi.jobs: a jobs runtime is already mounted in this process.');
  }
  const { mochiOptions } = config as JobsDescriptorInternal;
  const escapes = mochiOptions.queuert ?? {};
  const backend = mochiOptions.backend ?? { kind: 'memory' as const };

  const { stateAdapter, ownedDb, ownedSql } = await buildStateAdapter(backend, escapes.stateAdapter ?? {});

  const ownedNotify = !escapes.notifyAdapter;
  const notifyAdapter = escapes.notifyAdapter ?? (await createInProcessNotifyAdapter());

  const { log: userLog, ...clientEscapes } = escapes.client ?? {};

  try {
    const client = (await createClient({
      stateAdapter: stateAdapter as never,
      notifyAdapter,
      ...(escapes.observabilityAdapter ? { observabilityAdapter: escapes.observabilityAdapter } : {}),
      jobTypes: mochiOptions.types as never,
      log: buildJobsLog(userLog as Log | undefined),
      ...clientEscapes,
    })) as unknown as ErasedClient;

    const processors = createProcessors({
      client: client as never,
      jobTypes: mochiOptions.types as never,
      processors: mochiOptions.processors as never,
    });

    // Filtered after whatever the app declared so the result is applied last: a deployment can move the lease or poll
    // cadence for the whole app at once and still see via `explicit` whether the app chose a value itself.
    const leaseMs = applyFilter('jobs:leaseMs', mochiOptions.leaseMs ?? DEFAULT_JOBS_LEASE_MS, { explicit: mochiOptions.leaseMs !== undefined });
    const pollIntervalMs = applyFilter('jobs:pollIntervalMs', mochiOptions.pollIntervalMs ?? DEFAULT_JOBS_POLL_INTERVAL_MS, {
      explicit: mochiOptions.pollIntervalMs !== undefined,
    });

    const worker = await createInProcessWorker({
      client: client as never,
      concurrency: mochiOptions.concurrency,
      pollIntervalMs,
      ...(mochiOptions.workerName !== undefined ? { workerName: mochiOptions.workerName } : {}),
      defaults: {
        ...(mochiOptions.retry ? { backoffConfig: mochiOptions.retry } : {}),
        leaseConfig: { leaseMs, renewIntervalMs: Math.max(1_000, Math.min(30_000, Math.floor(leaseMs / 2))) },
      },
      processors: processors as never,
      ...escapes.worker,
    });
    const stopWorker = await worker.start();

    const runtime: JobsRuntime = { descriptor: config, client, stateAdapter, stopWorker, notifyAdapter, ownedNotify };
    if (ownedDb) {
      runtime.ownedDb = ownedDb;
    }
    if (ownedSql) {
      runtime.ownedSql = ownedSql;
    }
    registry.runtime = runtime;
    return Object.keys(mochiOptions.processors);
  } catch (err) {
    await stateAdapter.close().catch(() => {});
    if (ownedNotify) {
      await notifyAdapter.close().catch(() => {});
    }
    try {
      ownedDb?.close();
    } catch {
      // best-effort
    }
    await ownedSql?.close().catch(() => {});
    throw err;
  }
}

/**
 * Drain the jobs runtime — worker first (finishes in-flight attempts, stops pulling), then the adapters, then any
 * backend handle Mochi itself opened (never a caller-supplied `database`/`sql`). Idempotent and never throws, so it's
 * safe on both the `server.stop()` path and the signal path.
 */
export async function closeAllJobResources(): Promise<void> {
  const runtime = registry.runtime;
  if (!runtime) {
    return;
  }
  registry.runtime = null;
  try {
    await runtime.stopWorker();
  } catch (err) {
    logger.warn(`[jobs] worker stop failed: ${err instanceof Error ? err.message : err}`);
  }
  if (runtime.ownedNotify) {
    await runtime.notifyAdapter.close().catch(() => {});
  }
  await runtime.stateAdapter.close().catch(() => {});
  try {
    runtime.ownedDb?.close();
  } catch {
    // Windows keeps the file locked while a handle is open; best-effort.
  }
  await runtime.ownedSql?.close().catch(() => {});
}
