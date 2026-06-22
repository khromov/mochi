import { Mochi, mochiEvents } from 'mochi-framework';
import type { NotificationJob, ProcessedEntry, QueueStatus } from './types';

export const QUEUE_NAME = 'demo-notifications';

// In-memory so the demo writes no SQLite file into the site working dir; pass
// `dataPath` to persist.
export const notificationQueue = Mochi.queue<NotificationJob>(QUEUE_NAME);

// One server-owned snapshot, shared by every connected client. `inFlight` is
// tracked off the event bus (not per request) so it counts enqueues and
// completions from all browsers — everyone sees the same numbers.
const processed: ProcessedEntry[] = [];
let processedTotal = 0;
let inFlight = 0;

mochiEvents.on('queue:added', (e) => {
  if (e.queue === QUEUE_NAME) {
    inFlight++;
  }
});
const settle = (e: { queue: string }) => {
  if (e.queue === QUEUE_NAME) {
    inFlight = Math.max(0, inFlight - 1);
  }
};
mochiEvents.on('queue:completed', settle);
mochiEvents.on('queue:failed', settle);

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
  return { processed: [...processed].reverse(), processedTotal, inFlight };
}
