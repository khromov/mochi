import { Mochi } from 'mochi-framework';

export const QUEUE_NAME = 'demo-notifications';

export interface NotificationJob {
  user: string;
}

export interface ProcessedEntry {
  user: string;
  at: number;
}

export interface QueueStatus {
  processed: ProcessedEntry[];
  processedTotal: number;
}

// In-memory so the demo writes no SQLite file into the site working dir; jobs
// don't survive a restart, which is fine for a demo. Pass `dataPath` to persist.
export const notificationQueue = Mochi.queue<NotificationJob>(QUEUE_NAME);

const processed: ProcessedEntry[] = [];
let processedTotal = 0;

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
