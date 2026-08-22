// Components must import types from here, NOT from cron.server.ts: a type import from a side-effectful server
// module still drags that module into the SSR component bundle, re-registering its cron job a second time.

export interface CronLogEntry {
  seq: number;
  /** Epoch ms at which the cron handler ran. */
  at: number;
  /** The tick time (epoch ms) the run was scheduled for. */
  scheduledTime: number;
}

export type CronLogMessage = { type: 'snapshot'; entries: CronLogEntry[] } | { type: 'entry'; entry: CronLogEntry };
