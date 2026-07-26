/**
 * The single isolation boundary around croner: the only module that imports it,
 * with no croner type in the public surface, so swapping the scheduling engine
 * means rewriting just this file.
 *
 * Registration is inert. Declaring a task never starts a timer — `startScheduler`
 * (see `scheduler.ts`) decides which tasks run on this node and when, because on a
 * multi-node deployment most nodes run none of them.
 */
import { Cron } from 'croner';
import { pinGlobal } from '../utils/globalState';
import { mochiEvents } from '../events';
import { logger } from '../utils/log';
import { startupMilestoneReached } from '../lifecycle';

/** Whether a task runs on every node or on exactly one node in the deployment. */
export type MochiTaskScope = 'cluster' | 'node';

export interface MochiTaskContext {
  readonly name: string;
  /** The tick this run was scheduled for. Equal to the current time for a manual `trigger()`. */
  readonly scheduledAt: Date;
}

export type MochiTaskRunner = (context: MochiTaskContext) => void | Promise<void>;

/** The non-handler settings of a task — what survives on the inert `MochiTaskConfig.options`. */
export interface MochiTaskRuntimeOptions {
  /** Cron pattern, 5–6 fields (a leading seconds field is optional). Mutually exclusive with `at`. */
  cron?: string;
  /** One-off run at a specific time, as a `Date` or ISO 8601 string. Mutually exclusive with `cron`. */
  at?: Date | string;
  /** IANA zone (e.g. `'Europe/Stockholm'`) the pattern is interpreted in. Defaults to the host zone. */
  timezone?: string;
  /**
   * Allow a run to start while the previous one is still going. Default `false` —
   * an overlapping tick is skipped and reported as `task:skipped`, which is
   * almost always what a cron wants: a job that slows down should not pile up
   * copies of itself.
   */
  overlap?: boolean;
  /**
   * `'cluster'` (default) runs the task on exactly one node, chosen by the lease.
   * `'node'` runs it on every node and never touches the lease — for genuinely
   * per-process work like trimming a local cache.
   */
  scope?: MochiTaskScope;
  /** Register without scheduling. Start it later with the handle's `resume()`. */
  paused?: boolean;
}

export interface MochiTaskOptions extends MochiTaskRuntimeOptions {
  run: MochiTaskRunner;
  on?: { error?: (error: Error, context: MochiTaskContext) => void };
}

/** Live handle returned by `Mochi.task(name, …)` and `Mochi.getTask(name)`. */
export interface MochiTaskHandle {
  readonly name: string;
  readonly scope: MochiTaskScope;
  /** Next scheduled fire, or `null` when unscheduled on this node (not the leader, paused, or a one-off already past). */
  nextRun(): Date | null;
  previousRun(): Date | null;
  /** Whether this node currently has the task scheduled. */
  isScheduled(): boolean;
  /** Whether a run is executing right now. */
  isBusy(): boolean;
  /** Run now, regardless of schedule or leadership. Resolves when the run settles. */
  trigger(): Promise<void>;
  pause(): void;
  resume(): void;
}

interface TaskEntry {
  name: string;
  options: MochiTaskRuntimeOptions;
  run: MochiTaskRunner;
  onError?: (error: Error, context: MochiTaskContext) => void;
  /** Non-null only while this node has the task scheduled. */
  job: Cron | null;
  paused: boolean;
  busy: boolean;
  lastRun: Date | null;
  handle: MochiTaskHandle;
}

interface TaskRegistry {
  byName: Map<string, TaskEntry>;
  /** In-flight runs, awaited by `drainTasks` on shutdown. */
  inflight: Set<Promise<void>>;
  /**
   * Set by the scheduler: answers "may a cluster-scoped task fire right now?".
   * Consulted immediately before each run rather than only at start/stop, so a
   * leader whose process stalled past its lease TTL stops firing even though its
   * croner timers are still armed.
   */
  gate: () => boolean;
}

// Pinned like the queue registry: duplicate bundled copies of the framework must
// share one task list, or shutdown would drain only the copy it can see.
const registry = pinGlobal<TaskRegistry>('__mochi_task_registry__', () => ({
  byName: new Map(),
  inflight: new Set(),
  gate: () => true,
}));

export function setTaskGate(gate: () => boolean): void {
  registry.gate = gate;
}

function validate(name: string, options: MochiTaskRuntimeOptions): void {
  const hasCron = typeof options.cron === 'string' && options.cron.trim() !== '';
  const hasAt = options.at !== undefined;
  if (hasCron === hasAt) {
    throw new Error(`Mochi.task("${name}"): specify exactly one of \`cron\` (recurring) or \`at\` (one-off), not ${hasCron ? 'both' : 'neither'}.`);
  }
}

/** The pattern croner takes: a cron string, or a `Date` for a one-off. */
function toPattern(name: string, options: MochiTaskRuntimeOptions): string | Date {
  if (options.cron !== undefined) {
    return options.cron;
  }
  const at = options.at instanceof Date ? options.at : new Date(String(options.at));
  if (Number.isNaN(at.getTime())) {
    throw new Error(`Mochi.task("${name}"): \`at\` is not a valid date ("${String(options.at)}").`);
  }
  return at;
}

/**
 * Execute one run with the instrumentation every entry point shares: busy flag,
 * in-flight registration for shutdown drain, timing, events, and error containment.
 * A task that throws must never take the server down, so the error is reported and
 * swallowed here rather than escaping into croner's own handler.
 */
function execute(entry: TaskEntry, scheduledAt: Date): Promise<void> {
  const context: MochiTaskContext = { name: entry.name, scheduledAt };
  const started = performance.now();
  entry.busy = true;
  entry.lastRun = scheduledAt;

  const promise = (async () => {
    try {
      await entry.run(context);
      mochiEvents.emit('task:run', { task: entry.name, scope: entry.options.scope ?? 'cluster', duration: performance.now() - started });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`[task] ${entry.name} failed — ${error.message}`);
      mochiEvents.emit('task:error', { task: entry.name, error: error.message, duration: performance.now() - started });
      try {
        entry.onError?.(error, context);
      } catch (handlerErr) {
        logger.error(`[task] ${entry.name}: on.error handler threw — ${handlerErr instanceof Error ? handlerErr.message : String(handlerErr)}`);
      }
    } finally {
      entry.busy = false;
    }
  })();

  registry.inflight.add(promise);
  void promise.finally(() => registry.inflight.delete(promise));
  return promise;
}

/** Register a task without scheduling it. Idempotent per name — re-registering replaces the entry. */
export function createTask(name: string, options: MochiTaskOptions): MochiTaskHandle {
  validate(name, options);
  const { run, on, ...runtime } = options;

  const existing = registry.byName.get(name);
  if (existing) {
    // A dev-watcher reload re-imports the module that declared the task. Replace
    // the definition rather than stacking a second copy on the same name.
    existing.job?.stop();
    registry.byName.delete(name);
  }

  const entry: TaskEntry = {
    name,
    options: runtime,
    run,
    onError: on?.error,
    job: null,
    paused: runtime.paused ?? false,
    busy: false,
    lastRun: null,
    handle: undefined as unknown as MochiTaskHandle,
  };

  entry.handle = {
    name,
    scope: runtime.scope ?? 'cluster',
    nextRun: () => entry.job?.nextRun() ?? null,
    previousRun: () => entry.job?.previousRun() ?? entry.lastRun,
    isScheduled: () => entry.job !== null && !entry.paused,
    isBusy: () => entry.busy,
    trigger: () => execute(entry, new Date()),
    pause: () => {
      entry.paused = true;
      entry.job?.pause();
    },
    resume: () => {
      entry.paused = false;
      entry.job?.resume();
    },
  };

  registry.byName.set(name, entry);
  return entry.handle;
}

/** Arm this node's croner timer for `entry`, if it isn't already armed. */
function startEntry(entry: TaskEntry): void {
  if (entry.job !== null) {
    return;
  }
  const scope = entry.options.scope ?? 'cluster';
  entry.job = new Cron(
    toPattern(entry.name, entry.options),
    {
      name: entry.name,
      timezone: entry.options.timezone,
      paused: entry.paused,
      // NOT unref'd. An unref'd timer doesn't hold the event loop open, and if
      // nothing else does, it may simply never fire — so the task silently stops
      // running. That is the opposite of what a scheduled task is for, and it is
      // exactly how this wedged on Windows CI: with the loop otherwise idle,
      // waiting on a cron tick waited forever. Shutdown doesn't need the help
      // either — `stopAllTasks()` stops every job explicitly on the stop path,
      // which is deterministic where unref is merely a hint.
      // A function form of `protect` still lets us report the skip. With `true`
      // croner would silently drop the tick.
      protect: entry.options.overlap
        ? undefined
        : () => {
            mochiEvents.emit('task:skipped', { task: entry.name, reason: 'overlap' });
          },
    },
    () => {
      // The lease can expire between ticks — a stop-the-world pause or a lost
      // network is enough. Checking here rather than only at start/stop keeps a
      // node that no longer holds the lease from doing the leader's work.
      if (scope === 'cluster' && !registry.gate()) {
        mochiEvents.emit('task:skipped', { task: entry.name, reason: 'lease-expired' });
        return;
      }
      void execute(entry, new Date());
    },
  );
}

/** Arm every task this node should run. `cluster` tasks are skipped unless `includeCluster`. */
export function startTasks(includeCluster: boolean): void {
  for (const entry of registry.byName.values()) {
    const scope = entry.options.scope ?? 'cluster';
    if (scope === 'cluster' && !includeCluster) {
      continue;
    }
    startEntry(entry);
  }
}

/** Disarm cluster-scoped timers — used when this node loses the lease. In-flight runs are left to settle. */
export function stopClusterTasks(): void {
  for (const entry of registry.byName.values()) {
    if ((entry.options.scope ?? 'cluster') === 'cluster' && entry.job !== null) {
      entry.job.stop();
      entry.job = null;
    }
  }
}

/** Disarm every timer. Does not wait for in-flight runs — see {@link drainTasks}. */
export function stopAllTasks(): void {
  for (const entry of registry.byName.values()) {
    entry.job?.stop();
    entry.job = null;
  }
}

/**
 * Wait for in-flight runs to settle, bounded by `timeoutMs`. A task that outlives
 * the budget is abandoned rather than blocking shutdown forever — the process is
 * going away regardless, and holding the socket open past the deployment's grace
 * period just turns a slow shutdown into a killed one.
 */
export async function drainTasks(timeoutMs: number): Promise<void> {
  if (registry.inflight.size === 0) {
    return;
  }
  const pending = Promise.allSettled([...registry.inflight]);
  if (timeoutMs <= 0) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    // Deliberately NOT unref'd, unlike every other timer in the framework. Those
    // are periodic background timers that must never hold the process open; this
    // one is a deadline someone is awaiting. While we wait on a genuinely stuck
    // run, this timer is the only thing keeping the loop alive — unref it and the
    // loop goes idle, the timeout never fires, and `drainTasks` hangs forever,
    // which is the exact failure the budget exists to prevent. It is cleared the
    // moment the race settles, so it can never extend shutdown past `timeoutMs`.
    timer = setTimeout(resolve, timeoutMs);
  });
  const raced = await Promise.race([pending.then(() => 'drained' as const), budget.then(() => 'timeout' as const)]);
  clearTimeout(timer);
  if (raced === 'timeout') {
    logger.warn(`[task] ${registry.inflight.size} run(s) still going after ${timeoutMs}ms — abandoning them to finish shutdown.`);
  }
}

/**
 * Resolve a registered task's handle. Throws for an unknown name, distinguishing
 * "too early" from "typo" off the recorded startup milestone — the same three-way
 * diagnosis `getQueue()` makes, and for the same reason: an empty registry means
 * different things to an app that declared nothing and one that called too soon.
 */
export function getTask(name: string): MochiTaskHandle {
  const entry = registry.byName.get(name);
  if (!entry) {
    if (!startupMilestoneReached('mochi:tasksMounted')) {
      throw new Error(
        `Mochi.getTask("${name}"): tasks are not mounted yet. Mochi.serve({ tasks }) mounts them after the server binds, so call getTask() somewhere that runs later: the "mochi:ready" hook, or any request handler.`,
      );
    }
    if (registry.byName.size === 0) {
      throw new Error(`Mochi.getTask("${name}"): no tasks were declared. Add it to Mochi.serve({ tasks: { "${name}": Mochi.task(...) } }) first.`);
    }
    throw new Error(`Mochi.getTask("${name}"): no such task. Declared tasks: ${[...registry.byName.keys()].join(', ')}.`);
  }
  return entry.handle;
}

/** Every registered task's handle, for observability. */
export function listTasks(): MochiTaskHandle[] {
  return [...registry.byName.values()].map((entry) => entry.handle);
}

/** Drop every registration. Shutdown-path only; a bare `server.stop()` leaves them in place. */
export function clearTasks(): void {
  stopAllTasks();
  registry.byName.clear();
  registry.inflight.clear();
  registry.gate = () => true;
}
