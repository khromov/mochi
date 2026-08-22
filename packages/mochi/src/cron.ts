// Cron descriptors and validation. The durable runtime that talks to bun-boss lives in `queue.ts`, which is the only
// module allowed to import bun-boss; this file stays dependency-free so it can be imported anywhere.

/** The invocation handed to a cron handler. `scheduledTime` is when the underlying job ran. */
export interface MochiCronRun {
  readonly name: string;
  readonly schedule: string;
  /** Epoch ms at which this invocation started. */
  readonly scheduledTime: number;
  /** IANA zone the schedule is read in; absent when using the system zone. */
  readonly tz?: string;
}

export type MochiCronHandler = (run: MochiCronRun) => void | Promise<void>;

/** The non-handler settings — what survives on `MochiCronJob.options`. */
export interface MochiCronRuntimeOptions {
  /** IANA time-zone name the schedule is interpreted in. Default: UTC — durable cron reads the schedule in one zone across every node. */
  tz?: string;
  /** Register this job when `development: true`. Default: `true`. */
  dev?: boolean;
}

export interface MochiCronOptions extends MochiCronRuntimeOptions {
  run: MochiCronHandler;
}

export interface MochiCronJob {
  readonly __mochiCron: true;
  readonly name: string;
  readonly schedule: string;
  readonly run: MochiCronHandler;
  readonly options?: MochiCronRuntimeOptions;
  /** Next fire time (epoch ms) per `Bun.cron.parse`, or `null` when there is none within 8 years. For observability only. */
  nextRun(from?: number | Date): number | null;
}

const CRON_NAME_RE = /^[\w.\-/]+$/;

function tzOption(options?: MochiCronRuntimeOptions): { tz: string } | undefined {
  return options?.tz ? { tz: options.tz } : undefined;
}

/** Implements `Mochi.cron(name, schedule, config)` — see its JSDoc there. */
export function createCronJob(name: string, schedule: string, config: MochiCronOptions | MochiCronHandler): MochiCronJob {
  if (!CRON_NAME_RE.test(name)) {
    throw new Error(`Mochi.cron("${name}"): not a valid cron job name. Names may only contain letters, digits, underscores, dots, dashes, and slashes.`);
  }
  const { run, ...options } = typeof config === 'function' ? ({ run: config } as MochiCronOptions) : config;
  if (typeof run !== 'function') {
    throw new Error(`Mochi.cron("${name}"): expected a handler function, either as the third argument or as { run }.`);
  }

  const nextRun = (from: number | Date = Date.now()): number | null => {
    const next = Bun.cron.parse(schedule, from, tzOption(options));
    return next ? next.getTime() : null;
  };

  try {
    // Bun.cron.parse is pure; using it here surfaces a bad expression at import time, long before the server boots.
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

  return { __mochiCron: true, name, schedule, run, options, nextRun };
}
