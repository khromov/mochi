// The isolation boundary around `Bun.cron`: the only module calling it, the way queue.ts is the only one importing bun-boss.
import { mochiEvents } from './events';
import { isBuildingEntry } from './utils/buildFlag';
import { pinGlobal } from './utils/globalState';
import { logger } from './utils/log';

/** The invocation handed to a cron handler — data, not Bun's `CronJob`. Mirrors `MochiJob`. */
export interface MochiCronRun {
  readonly name: string;
  readonly schedule: string;
  /** Epoch ms at which this invocation started. */
  readonly scheduledTime: number;
  /** IANA zone the schedule is read in; absent when using the system zone. */
  readonly tz?: string;
}

export type MochiCronHandler = (run: MochiCronRun) => void | Promise<void>;

/** Lifecycle listeners, mirroring `MochiQueueListeners`. A handler that throws surfaces through `failed`. */
export interface MochiCronListeners {
  active: (run: MochiCronRun) => void;
  completed: (run: MochiCronRun, durationMs: number) => void;
  failed: (run: MochiCronRun, error: Error) => void;
}

/** The non-handler settings — what survives on `MochiCronJob.options`. */
export interface MochiCronRuntimeOptions {
  /** IANA time-zone name the schedule is interpreted in. Default: the system zone, matching crontab and launchd. */
  tz?: string;
  /** Register this job when `development: true`. Default: `true`. */
  dev?: boolean;
}

export interface MochiCronOptions extends MochiCronRuntimeOptions {
  run: MochiCronHandler;
  on?: Partial<MochiCronListeners>;
}

export interface MochiCronJob {
  readonly __mochiCron: true;
  readonly name: string;
  readonly schedule: string;
  readonly run: MochiCronHandler;
  readonly options?: MochiCronRuntimeOptions;
  readonly on?: Partial<MochiCronListeners>;
  /** Next fire time (epoch ms) per `Bun.cron.parse`, or `null` when there is none within 8 years. */
  nextRun(from?: number | Date): number | null;
}

const CRON_NAME_RE = /^[\w.\-/]+$/;

interface CronRegistry {
  jobs: Map<string, { job: MochiCronJob; handle: { stop(): unknown } }>;
}

// Pinned for the same reason the queue registry is: `stopAllCronJobs()` runs from module scope and must see the
// entries whichever bundled copy of this module registered them.
const registry = pinGlobal<CronRegistry>('__mochi_cron_registry__', () => ({ jobs: new Map() }));

function tzOption(options?: MochiCronRuntimeOptions): { tz: string } | undefined {
  return options?.tz ? { tz: options.tz } : undefined;
}

/** Implements `Mochi.cron(name, schedule, config)` — see its JSDoc there. */
export function createCronJob(name: string, schedule: string, config: MochiCronOptions | MochiCronHandler): MochiCronJob {
  if (!CRON_NAME_RE.test(name)) {
    throw new Error(`Mochi.cron("${name}"): not a valid cron job name. Names may only contain letters, digits, underscores, dots, dashes, and slashes.`);
  }
  const { run, on, ...options } = typeof config === 'function' ? ({ run: config } as MochiCronOptions) : config;
  if (typeof run !== 'function') {
    throw new Error(`Mochi.cron("${name}"): expected a handler function, either as the third argument or as { run }.`);
  }

  const nextRun = (from: number | Date = Date.now()): number | null => {
    // `Bun.cron.parse` is pure, so validating here costs nothing at import time and never schedules anything.
    const next = Bun.cron.parse(schedule, from, tzOption(options));
    return next ? next.getTime() : null;
  };

  try {
    if (nextRun() === null) {
      throw new Error(`Mochi.cron("${name}"): schedule "${schedule}" has no occurrence in the next 8 years — check for an impossible date like February 30th ("0 0 30 2 *").`);
    }
  } catch (err) {
    // Bun throws TypeError for a malformed expression or an unknown time zone; everything else is already ours.
    if (err instanceof TypeError) {
      throw new Error(
        `Mochi.cron("${name}"): "${schedule}"${options.tz ? ` in time zone "${options.tz}"` : ''} is not a valid cron schedule — ${err.message}. Expected 5 fields (minute hour day-of-month month day-of-week) or a nickname like "@daily".`,
        { cause: err },
      );
    }
    throw err;
  }

  return { __mochiCron: true, name, schedule, run, options, on, nextRun };
}

// A throwing listener must not change what happens to the run, mirroring the queue's rule for its own listeners.
function notifySafely(name: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    logger.error(`[cron] ${name}: listener threw — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Wrap a user handler so it always resolves. This is the whole reason cron jobs go through Mochi rather than straight
 * to `Bun.cron`: a bare handler that throws reaches `uncaughtException`/`unhandledRejection` and takes the process
 * down with exit code 1. Here a failure is one `cron:failed` event and one log line, and the schedule keeps running.
 */
function wrapHandler(job: MochiCronJob): () => Promise<void> {
  const { name, schedule, run, on: listeners } = job;
  const tz = job.options?.tz;
  return async () => {
    const invocation: MochiCronRun = { name, schedule, scheduledTime: Date.now(), ...(tz ? { tz } : {}) };
    const started = performance.now();
    notifySafely(name, () => mochiEvents.emit('cron:active', { job: name, schedule, scheduledTime: invocation.scheduledTime }));
    notifySafely(name, () => listeners?.active?.(invocation));
    try {
      await run(invocation);
      const duration = performance.now() - started;
      notifySafely(name, () => mochiEvents.emit('cron:completed', { job: name, schedule, duration }));
      notifySafely(name, () => listeners?.completed?.(invocation, duration));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const duration = performance.now() - started;
      logger.error(`[cron] ${name}: ${error.message}`);
      notifySafely(name, () => mochiEvents.emit('cron:failed', { job: name, schedule, duration, error: error.message }));
      notifySafely(name, () => listeners?.failed?.(invocation, error));
    }
  };
}

/**
 * Register every declared job with `Bun.cron`. Invocations never overlap — Bun computes the next fire only once the
 * returned promise settles, and the wrapper settles when the handler does.
 */
export function startCronJobs(jobs: MochiCronJob[], opts: { development: boolean }): void {
  // A `mochi-framework build` imports the app entry for real; starting timers there would outlive the build.
  if (isBuildingEntry()) {
    return;
  }
  try {
    for (const job of jobs) {
      if (opts.development && job.options?.dev === false) {
        continue;
      }
      const handle = Bun.cron(job.schedule, wrapHandler(job), tzOption(job.options));
      registry.jobs.set(job.name, { job, handle });
      const next = job.nextRun();
      mochiEvents.emit('cron:scheduled', {
        job: job.name,
        schedule: job.schedule,
        ...(job.options?.tz ? { tz: job.options.tz } : {}),
        ...(next === null ? {} : { nextRun: next }),
      });
    }
  } catch (err) {
    // Never leave half a schedule registered: the caller tears the server down on this.
    stopAllCronJobs();
    throw err;
  }
}

/** Stop every registered job. Idempotent and never throws, so every shutdown path can call it unconditionally. */
export function stopAllCronJobs(): void {
  for (const [name, { handle }] of registry.jobs) {
    try {
      handle.stop();
    } catch (err) {
      logger.warn(`[cron] ${name}: stop failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  registry.jobs.clear();
}

/** Names of the jobs currently registered in this process. */
export function registeredCronJobs(): string[] {
  return [...registry.jobs.keys()];
}
