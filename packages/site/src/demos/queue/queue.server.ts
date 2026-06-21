import { Mochi } from 'mochi-framework';
import type { NotificationJob, ProcessedEntry, QueueStatus } from './types';

export const QUEUE_NAME = 'demo-notifications';

// In-memory so the demo writes no SQLite file into the site working dir; jobs
// don't survive a restart, which is fine for a demo. Pass `dataPath` to persist.
export const notificationQueue = Mochi.queue<NotificationJob>(QUEUE_NAME);

const processed: ProcessedEntry[] = [];
let processedTotal = 0;

// Mochi.worker() is idempotent per queue name: in dev the route-HMR watcher
// re-runs this module, but the framework keeps the first worker (and warns)
// instead of spawning a duplicate that would write to a divergent copy of the
// state below. Worker code changes need a server restart to take effect.
Mochi.worker<NotificationJob>(
  QUEUE_NAME,
  async (job) => {
    // Simulate the latency of actually delivering a notification so the UI shows
    // the queued → processing → done transition rather than completing instantly.
    await Bun.sleep(700);
    processed.push({ user: job.data.user, at: Date.now() });
    if (processed.length > 20) {
      processed.shift();
    }
    processedTotal++;
    return { delivered: true };
  },
  { concurrency: 2 },
);

export function queueStatus(): QueueStatus {
  return { processed: [...processed].reverse(), processedTotal };
}
