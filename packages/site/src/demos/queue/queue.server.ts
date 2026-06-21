import { Mochi } from 'mochi-framework';
import type { NotificationJob, ProcessedEntry, QueueStatus } from './types';

export const QUEUE_NAME = 'demo-notifications';

// In-memory so the demo writes no SQLite file into the site working dir; jobs
// don't survive a restart, which is fine for a demo. Pass `dataPath` to persist.
export const notificationQueue = Mochi.queue<NotificationJob>(QUEUE_NAME);

const processed: ProcessedEntry[] = [];
let processedTotal = 0;

// Inert worker config — the live worker starts only when this is mounted in
// Mochi.serve({ workers: { [QUEUE_NAME]: notificationWorker } }). The module is
// imported once, so the closure below (and the state it captures) is single even
// under dev route-reload; worker changes still need a server restart.
export const notificationWorker = Mochi.worker<NotificationJob>(
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
