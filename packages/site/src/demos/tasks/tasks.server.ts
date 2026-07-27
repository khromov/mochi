import { Mochi } from 'mochi-framework';
import type { MochiTaskConfig } from 'mochi-framework';
import type { TaskStatus, TaskTick } from './types';

export const TASK_NAME = 'demo-heartbeat';

// One server-owned history shared by every client, so two browsers see the same ticks rather than diverging per-session logs.
const ticks: TaskTick[] = [];
let total = 0;

export const heartbeatTask: MochiTaskConfig = Mochi.task({
  // Every 5 seconds — frequent enough to watch, slow enough to read.
  cron: '*/5 * * * * *',
  run: ({ scheduledAt }) => {
    total++;
    ticks.push({ at: scheduledAt.getTime(), sequence: total });
    if (ticks.length > 12) {
      ticks.shift();
    }
  },
});

export function taskStatus(): TaskStatus {
  // `nextRun()` is null before the scheduler arms the task and on any non-leader node — both ordinary states, not errors.
  let nextRun: number | null = null;
  try {
    nextRun = Mochi.getTask(TASK_NAME).nextRun()?.getTime() ?? null;
  } catch {
    // Reached before Mochi.serve() mounted its tasks.
  }
  return { ticks: [...ticks].reverse(), total, nextRun };
}
