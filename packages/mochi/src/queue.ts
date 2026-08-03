// The isolation boundary around the queue transport: messages travel through fedify `MessageQueue` drivers
// (see queue/backends.ts), while retry, backoff, concurrency, and the `queue:*` events live here in Mochi's worker
// layer — the drivers are pure transports and never see a failure.
import type { MessageQueueEnqueueOptions } from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import { pinGlobal } from './utils/globalState';
import { applyFilter } from './extensions';
import { startupMilestoneReached } from './lifecycle';
import { mochiEvents } from './events';
import { logger } from './utils/log';
import { resolveBackend, closeBackendResources } from './queue/backends';
import type { MochiQueueBackend } from './queue/backends';
import { WorkerPool } from './queue/workerPool';

export type { MochiQueueBackend } from './queue/backends';

/** Deliberately narrow — data, not the transport message — so userland can't reach behind the abstraction. */
export interface MochiJob<T> {
  readonly id: string;
  readonly name: string;
  readonly data: T;
  readonly queue: string;
  /** 1-based; increments on each retry re-enqueue. */
  readonly attempt: number;
  readonly enqueuedAt: number;
}

export type MochiProcessor<T, R> = (job: MochiJob<T>) => R | Promise<R>;

/** Lightweight handle returned by `add()` / `addBulk()`. */
export interface MochiJobRef {
  id: string;
  name: string;
}

/** Failure backoff between retry attempts; `exponential` doubles per attempt: `delay * 2^(attempt-1)`. */
export interface MochiBackoffOptions {
  type: 'fixed' | 'exponential';
  /** Base delay in ms. */
  delay: number;
  maxDelay?: number;
}

export interface MochiJobOptions {
  /** Delay before the job becomes runnable, in ms. */
  delay?: number;
  attempts?: number;
  /** Jobs sharing an ordering key are delivered sequentially (guarantee strength is backend-dependent; combine with `concurrency: 1` for strict ordering). */
  orderingKey?: string;
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
  /** Where messages live — defaults to the serve-level `queueBackend`, then `'memory'`. */
  backend?: MochiQueueBackend;
  /** Applied between retry attempts when a job fails with attempts remaining. */
  backoff?: MochiBackoffOptions;
  defaultJobOptions?: MochiJobOptions;
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

/** What's waiting in the backend store, excluding jobs already handed to the processor. */
export interface MochiQueueDepth {
  queued: number;
  ready?: number;
  delayed?: number;
}

/** Handle returned by `Mochi.getQueue(name)` — what you add jobs through. */
export interface MochiQueue<T> {
  readonly name: string;
  add(name: string, data: T, opts?: MochiJobOptions): Promise<MochiJobRef>;
  addBulk(jobs: Array<{ name: string; data: T; opts?: MochiJobOptions }>): Promise<MochiJobRef[]>;
  /** `undefined` when the backend driver doesn't report depth. */
  depth(): Promise<MochiQueueDepth | undefined>;
}

/** The wire format every Mochi job travels as, whatever the backend. */
interface MochiQueueEnvelope<T> {
  /** Marker + version; a message without it (e.g. a foreign producer on a shared store) is dropped with a `queue:error`. */
  __mochi: 1;
  id: string;
  name: string;
  data: T;
  /** 1-based; incremented on each retry re-enqueue. */
  attempt: number;
  /** Total attempts allowed, resolved at first enqueue. */
  attempts: number;
  /** Epoch ms of the FIRST enqueue, preserved across retries. */
  enqueuedAt: number;
  orderingKey?: string;
}

interface MountedQueue {
  name: string;
  controller: AbortController;
  listening: Promise<void>;
  pool: WorkerPool;
}

interface QueueRegistry {
  /** Producer handles, keyed by name; what `getQueue()` resolves. */
  byName: Map<string, MochiQueue<unknown>>;
  /** Live listen loops + pools, for `closeAllQueueResources` to drain on shutdown. */
  mounted: Set<MountedQueue>;
}

// Pinned so every duplicate bundled copy of this module shares one registry, since `closeAllQueueResources` must see
// every resource to drain it whichever copy created it.
const registry = pinGlobal<QueueRegistry>('__mochi_queue_registry__', () => ({
  byName: new Map(),
  mounted: new Set(),
}));

function backoffDelayMs(backoff: MochiBackoffOptions | undefined, failedAttempt: number): number {
  if (!backoff) {
    return 0;
  }
  const delay = backoff.type === 'exponential' ? backoff.delay * 2 ** (failedAttempt - 1) : backoff.delay;
  return backoff.maxDelay !== undefined ? Math.min(delay, backoff.maxDelay) : delay;
}

// The fedify enqueue contract wants a real Temporal.Duration; the polyfill's is duck-type-compatible (the drivers call
// `.total()` rather than instanceof-checking) but not type-identical to the `esnext.temporal` lib type, hence the cast.
function enqueueOptions<T>(env: MochiQueueEnvelope<T>, delayMs: number): MessageQueueEnqueueOptions {
  return {
    delay: delayMs > 0 ? (Temporal.Duration.from({ milliseconds: Math.round(delayMs) }) as unknown as MessageQueueEnqueueOptions['delay']) : undefined,
    orderingKey: env.orderingKey,
  };
}

function toMochiJob<T>(env: MochiQueueEnvelope<T>, queueName: string): MochiJob<T> {
  return {
    id: env.id,
    name: env.name,
    data: env.data,
    queue: queueName,
    attempt: env.attempt,
    enqueuedAt: env.enqueuedAt,
  };
}

/**
 * Resolve the backend, register the producer under `name` for `getQueue`, and start the consumer listen loop feeding
 * `process` through a concurrency-capped worker pool. Called only by `Mochi.serve`, where a queue is declared once with
 * its processor co-located.
 */
export async function createQueue<T = unknown, R = unknown>(
  name: string,
  process: MochiProcessor<T, R>,
  options?: MochiQueueRuntimeOptions,
  listeners?: Partial<MochiQueueListeners<T, R>>,
): Promise<MochiQueue<T>> {
  const { queue: transport } = await resolveBackend(name, options?.backend);
  const defaults = options?.defaultJobOptions;
  const backoff = options?.backoff;

  const toEnvelope = (jobName: string, data: T, opts?: MochiJobOptions): MochiQueueEnvelope<T> => ({
    __mochi: 1,
    id: crypto.randomUUID(),
    name: jobName,
    data,
    attempt: 1,
    attempts: Math.max(1, opts?.attempts ?? defaults?.attempts ?? 1),
    enqueuedAt: Date.now(),
    orderingKey: opts?.orderingKey ?? defaults?.orderingKey,
  });

  const producer: MochiQueue<T> = {
    name,
    async add(jobName, data, jobOpts) {
      const env = toEnvelope(jobName, data, jobOpts);
      await transport.enqueue(env, enqueueOptions(env, jobOpts?.delay ?? defaults?.delay ?? 0));
      mochiEvents.emit('queue:added', { queue: name, jobId: env.id, jobName: env.name });
      return { id: env.id, name: env.name };
    },
    async addBulk(jobs) {
      // `enqueueMany` takes one options object for the whole batch, so jobs are grouped by effective (delay, orderingKey).
      const groups = new Map<string, { delayMs: number; envelopes: MochiQueueEnvelope<T>[] }>();
      for (const job of jobs) {
        const env = toEnvelope(job.name, job.data, job.opts);
        const delayMs = job.opts?.delay ?? defaults?.delay ?? 0;
        const key = delayMs + '\u0000' + (env.orderingKey ?? '');
        const group = groups.get(key);
        if (group) {
          group.envelopes.push(env);
        } else {
          groups.set(key, { delayMs, envelopes: [env] });
        }
      }
      const refs: MochiJobRef[] = [];
      for (const { delayMs, envelopes } of groups.values()) {
        const [first] = envelopes;
        if (!first) {
          continue;
        }
        const opts = enqueueOptions(first, delayMs);
        if (typeof transport.enqueueMany === 'function') {
          await transport.enqueueMany(envelopes, opts);
        } else {
          for (const env of envelopes) {
            await transport.enqueue(env, opts);
          }
        }
        for (const env of envelopes) {
          mochiEvents.emit('queue:added', { queue: name, jobId: env.id, jobName: env.name });
          refs.push({ id: env.id, name: env.name });
        }
      }
      return refs;
    },
    async depth() {
      if (typeof transport.getDepth !== 'function') {
        return undefined;
      }
      const depth = await transport.getDepth();
      return { queued: depth.queued, ready: depth.ready, delayed: depth.delayed };
    },
  };

  const sinks: { [K in keyof MochiQueueListeners<T, R>]: Set<MochiQueueListeners<T, R>[K]> } = {
    active: new Set(),
    completed: new Set(),
    failed: new Set(),
    error: new Set(),
  };
  if (listeners) {
    for (const key of Object.keys(listeners) as (keyof MochiQueueListeners<T, R>)[]) {
      const listener = listeners[key];
      if (listener) {
        (sinks[key] as unknown as Set<unknown>).add(listener);
      }
    }
  }

  const pool = new WorkerPool(Math.max(1, options?.concurrency ?? 1));

  const runJob = async (env: MochiQueueEnvelope<T>): Promise<void> => {
    const job = toMochiJob(env, name);
    mochiEvents.emit('queue:active', { queue: name, jobId: env.id, jobName: env.name, attempt: env.attempt });
    for (const l of sinks.active) {
      l(job);
    }
    const startedAt = performance.now();
    try {
      const result = await process(job);
      mochiEvents.emit('queue:completed', { queue: name, jobId: env.id, jobName: env.name, attempt: env.attempt, duration: performance.now() - startedAt });
      for (const l of sinks.completed) {
        l(job, result);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const willRetry = env.attempt < env.attempts;
      mochiEvents.emit('queue:failed', {
        queue: name,
        jobId: env.id,
        jobName: env.name,
        attempt: env.attempt,
        duration: performance.now() - startedAt,
        error: error.message,
        willRetry,
      });
      for (const l of sinks.failed) {
        l(job, error);
      }
      if (willRetry) {
        try {
          const retryEnv: MochiQueueEnvelope<T> = { ...env, attempt: env.attempt + 1 };
          await transport.enqueue(retryEnv, enqueueOptions(retryEnv, backoffDelayMs(backoff, env.attempt)));
        } catch (requeueErr) {
          const message = requeueErr instanceof Error ? requeueErr.message : String(requeueErr);
          logger.error(`[queue] ${name}: failed to re-enqueue job ${env.id} for retry — ${message}`);
          mochiEvents.emit('queue:error', { queue: name, error: message });
          for (const l of sinks.error) {
            l(requeueErr instanceof Error ? requeueErr : new Error(message));
          }
        }
      }
    }
  };

  const controller = new AbortController();
  // The handler resolves once a pool slot is free and the job has STARTED, so the transport's listen loop can hand over
  // the next message while up to `concurrency` jobs run; it also never throws, so driver-native retry never engages and
  // Mochi's retry semantics stay uniform across backends.
  const listening = transport
    .listen(
      (message: unknown) => {
        const env = message as MochiQueueEnvelope<T>;
        if (typeof env !== 'object' || env === null || env.__mochi !== 1) {
          mochiEvents.emit('queue:error', { queue: name, error: `Dropped a non-Mochi message from the backend store: ${JSON.stringify(message)?.slice(0, 200)}` });
          return;
        }
        return pool.run(() => runJob(env));
      },
      { signal: controller.signal },
    )
    .catch((err: unknown) => {
      // A dead listen loop means the consumer is gone while producers keep enqueueing — surface loudly.
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[queue] ${name}: listener stopped unexpectedly — ${message}`);
      mochiEvents.emit('queue:error', { queue: name, error: message });
      for (const l of sinks.error) {
        l(err instanceof Error ? err : new Error(message));
      }
    });

  registry.byName.set(name, producer as MochiQueue<unknown>);
  registry.mounted.add({ name, controller, listening, pool });
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
 * TODO: single-flight recovery across processes. Recovery currently runs in
 * every process that boots, so an N-instance deploy (or a rolling restart where
 * old and new overlap) has N processes re-enqueueing the same work from the same
 * store — N copies of every stranded job. Today only single-instance apps are
 * safe, which the queues docs already imply but don't state.
 *
 * The intended shape, in order:
 *   1. Sleep a random jitter before touching the store — default 0–5000ms, with
 *      the bounds filterable per queue (`queue:recoveryJitterMinMs` /
 *      `queue:recoveryJitterMaxMs`, alongside the stall-warning filter below).
 *      Note this delays `serve()` resolving, so the default upper bound is a
 *      boot-latency tradeoff, and 0/0 must remain a clean opt-out.
 *   2. Try to acquire a lease named for the queue through a cross-process
 *      persistence layer that DOES NOT EXIST YET — it has to outlive any single
 *      process, so `pinGlobal` doesn't qualify (a shared postgres backend could
 *      carry one, but memory/sqlite deployments need an answer too). Designing
 *      that store is the actual blocking work here.
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
 * Drain every queue resource: stop the listen loops, wait for in-flight jobs to
 * settle, then close the backing stores. Idempotent and never throws, so it's
 * safe on both the serve shutdown path and the build drain path.
 */
export async function closeAllQueueResources(): Promise<void> {
  const mounted = [...registry.mounted];
  // Listen loops first so no new message is handed over, then the pools so running jobs settle — a retry re-enqueued
  // mid-drain still finds its store open, since the stores close only after.
  for (const m of mounted) {
    m.controller.abort();
  }
  await Promise.allSettled(mounted.map((m) => m.listening));
  await Promise.allSettled(mounted.map((m) => m.pool.drain()));
  await closeBackendResources();
  registry.byName.clear();
  registry.mounted.clear();
}
