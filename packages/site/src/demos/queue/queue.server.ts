import { Mochi, mochiEvents } from 'mochi-framework';
import type { MochiQueueConfig } from 'mochi-framework';
import type { NotificationJob, ProcessedEntry, QueueStatus } from './types';

export const QUEUE_NAME = 'demo-notifications';

// `inFlight` is tracked off the event bus, not per request, so every connected browser sees the same numbers.
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

// The site rides the default `queueStorage: 'memory'`, so the demo writes no queue file into the working dir;
// set `Mochi.serve({ queueStorage })` to persist.
export const notificationQueue: MochiQueueConfig = Mochi.queue<NotificationJob>({
  concurrency: 2,
  process: async (job) => {
    // Simulate delivery latency so the UI shows the queued → processing → done transition.
    const start = Date.now();
    await Bun.sleep(500 + Math.random() * 1500);
    processed.push({ user: job.data.user, at: Date.now(), ms: Date.now() - start });
    if (processed.length > 20) {
      processed.shift();
    }
    processedTotal++;
    return { delivered: true };
  },
});

export function queueStatus(): QueueStatus {
  return { processed: [...processed].reverse(), processedTotal, inFlight };
}
