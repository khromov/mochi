/**
 * The single isolation boundary around croner, so swapping the scheduling engine
 * means rewriting just this file. Registration is inert — `startScheduler` decides
 * which tasks this node runs, since on a multi-node deployment most nodes run none.
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
  /** Allow a run to start while the previous one is still going. Default `false` — an overlapping tick is skipped and reported as `task:skipped`. */
  overlap?: boolean;
  /** `'cluster'` (default) runs on exactly one node, chosen by the lease. `'node'` runs on every node and never touches the lease. */
  scope?: MochiTaskScope;
  /** Register without scheduling. Start it later with the handle's `resume()`. */
  paused?: boolean;
  /**
   * Also run once as soon as this node arms the task, on top of the schedule. Requires `cron`.
   * Fires at most once per registration, so a leader flapping on its TTL doesn't re-run work that is rarely safe to repeat.
   */
  runOnStart?: boolean;
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
  job: Cron | null;
  startTimer: ReturnType<typeof setTimeout> | null;
  /** Latches the `runOnStart` fire so regaining a lost lease doesn't repeat it. */
  ranOnStart: boolean;
  paused: boolean;
  busy: boolean;
  lastRun: Date | null;
  handle: MochiTaskHandle;
}

interface TaskRegistry {
  byName: Map<string, TaskEntry>;
  /** In-flight runs, awaited by `drainTasks` on shutdown. */
  inflight: Set<Promise<void>>;
  /** Set by the scheduler. Consulted before each run, so a leader stalled past its lease TTL stops firing even with its timers still armed. */
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
  if (options.runOnStart === true && hasAt) {
    throw new Error(`Mochi.task("${name}"): \`runOnStart\` needs \`cron\` — an \`at\` task already runs exactly once, and adding a startup run would make it twice.`);
  }
}

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

/** A task that throws must never take the server down, so the error is reported and swallowed here rather than escaping into croner's own handler. */
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

const RESERVED_PREFIX = 'mochi:';

function registerTask(name: string, options: MochiTaskOptions): MochiTaskHandle {
  validate(name, options);
  const { run, on, ...runtime } = options;

  const existing = registry.byName.get(name);
  if (existing) {
    // A dev-watcher reload re-imports the module that declared the task. Replace
    // the definition rather than stacking a second copy on the same name.
    disarm(existing);
    registry.byName.delete(name);
  }

  const entry: TaskEntry = {
    name,
    options: runtime,
    run,
    onError: on?.error,
    job: null,
    startTimer: null,
    ranOnStart: false,
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

export function createTask(name: string, options: MochiTaskOptions): MochiTaskHandle {
  if (name.startsWith(RESERVED_PREFIX)) {
    throw new Error(`Mochi.task("${name}"): names starting with "${RESERVED_PREFIX}" are reserved for the framework's own tasks. Pick another name.`);
  }
  return registerTask(name, options);
}

/** Bypasses the reserved-prefix guard, which exists so an app can't shadow — and thereby silently delete — a task Mochi depends on. */
export function createInternalTask(name: string, options: MochiTaskOptions): MochiTaskHandle {
  return registerTask(name, options);
}

function disarm(entry: TaskEntry): void {
  entry.job?.stop();
  entry.job = null;
  if (entry.startTimer !== null) {
    clearTimeout(entry.startTimer);
    entry.startTimer = null;
  }
}

/** The one path into a run that isn't an explicit `trigger()`, so the two guards below can't be bypassed by adding a third caller. */
function fire(entry: TaskEntry, scope: MochiTaskScope): void {
  // The lease can expire between ticks, so check per-run rather than only at
  // start/stop — otherwise a node that lost it keeps doing the leader's work.
  if (scope === 'cluster' && !registry.gate()) {
    mochiEvents.emit('task:skipped', { task: entry.name, reason: 'lease-expired' });
    return;
  }
  // Not croner's `protect` option: the callback hands `execute` off as a detached
  // promise, so croner's blocking flag clears a microtask later and every tick
  // looks idle to it. `runOnStart` fires outside croner entirely.
  if (entry.options.overlap !== true && entry.busy) {
    mochiEvents.emit('task:skipped', { task: entry.name, reason: 'overlap' });
    return;
  }
  void execute(entry, new Date());
}

function startEntry(entry: TaskEntry): void {
  if (entry.job !== null) {
    return;
  }
  const scope = entry.options.scope ?? 'cluster';
  const pattern = toPattern(entry.name, entry.options);
  try {
    entry.job = new Cron(
      pattern,
      {
        name: entry.name,
        timezone: entry.options.timezone,
        paused: entry.paused,
        // NOT unref'd: an unref'd timer never fires if nothing else holds the loop
        // open, which is how this wedged on Windows CI. `stopAllTasks()` handles
        // shutdown explicitly, where unref is merely a hint.
      },
      () => fire(entry, scope),
    );
  } catch (err) {
    // croner names the pattern but not the task, which is useless once the
    // registry holds tasks the app never declared.
    throw new Error(`Mochi.task("${entry.name}"): invalid schedule "${String(pattern)}" — ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  if (entry.options.runOnStart === true && !entry.ranOnStart && !entry.paused) {
    entry.ranOnStart = true;
    // Deferred a macrotask so arming a task never runs its body inside
    // `Mochi.serve()`, which calls `startTasks()` synchronously.
    entry.startTimer = setTimeout(() => {
      entry.startTimer = null;
      fire(entry, scope);
    }, 0);
  }
}

export function startTasks(includeCluster: boolean): void {
  for (const entry of registry.byName.values()) {
    const scope = entry.options.scope ?? 'cluster';
    if (scope === 'cluster' && !includeCluster) {
      continue;
    }
    startEntry(entry);
  }
}

/** In-flight runs are left to settle. */
export function stopClusterTasks(): void {
  for (const entry of registry.byName.values()) {
    if ((entry.options.scope ?? 'cluster') === 'cluster') {
      disarm(entry);
    }
  }
}

/** Does not wait for in-flight runs — see {@link drainTasks}. */
export function stopAllTasks(): void {
  for (const entry of registry.byName.values()) {
    disarm(entry);
  }
}

/** `node`-scoped tasks never touch the lease, so a registry holding only those has nothing to elect and `startScheduler` skips opening a lease store. */
export function hasClusterTasks(): boolean {
  for (const entry of registry.byName.values()) {
    if ((entry.options.scope ?? 'cluster') === 'cluster') {
      return true;
    }
  }
  return false;
}

/**
 * Wait for in-flight runs to settle, bounded by `timeoutMs`. A task that outlives the budget is
 * abandoned, since holding the socket open past the deployment's grace period turns a slow shutdown into a killed one.
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
    // NOT unref'd, same hazard as the cron timer above: while we wait on a stuck
    // run this is the only thing keeping the loop alive, so unref'ing it would
    // hang the very drain the budget exists to bound. Cleared once the race settles.
    timer = setTimeout(resolve, timeoutMs);
  });
  const raced = await Promise.race([pending.then(() => 'drained' as const), budget.then(() => 'timeout' as const)]);
  clearTimeout(timer);
  if (raced === 'timeout') {
    logger.warn(`[task] ${registry.inflight.size} run(s) still going after ${timeoutMs}ms — abandoning them to finish shutdown.`);
  }
}

/** Distinguishes "too early" from "typo" off the startup milestone, since an empty registry means different things to an app that declared nothing and one that called too soon. */
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

export function listTasks(): MochiTaskHandle[] {
  return [...registry.byName.values()].map((entry) => entry.handle);
}

/** Shutdown-path only; a bare `server.stop()` leaves registrations in place. */
export function clearTasks(): void {
  stopAllTasks();
  registry.byName.clear();
  registry.inflight.clear();
  registry.gate = () => true;
}
