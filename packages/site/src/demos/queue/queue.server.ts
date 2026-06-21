import { Mochi } from 'mochi-framework';
import type { NotificationJob, ProcessedEntry, QueueStatus } from './types';

export const QUEUE_NAME = 'demo-notifications';

// In-memory so the demo writes no SQLite file into the site working dir; pass
// `dataPath` to persist.
export const notificationQueue = Mochi.queue<NotificationJob>(QUEUE_NAME);

const processed: ProcessedEntry[] = [];
let processedTotal = 0;

export const notificationWorker = Mochi.worker<NotificationJob>(
  async (job) => {
    // Simulate delivery latency so the UI shows the queued → processing → done
    // transition rather than completing instantly.
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
