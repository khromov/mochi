import { Mochi, mochiEvents } from 'mochi-framework';
import type { NotificationJob, ProcessedEntry, QueueStatus } from './types';

export const QUEUE_NAME = 'demo-notifications';

// Pending jobs are tracked off the event bus, not per request, so every connected browser sees the same numbers.
const processed: ProcessedEntry[] = [];
let processedTotal = 0;
let reservations = 0;

export const MAX_PENDING_NOTIFICATION_JOBS = 100;

// Jobs here take under two seconds, so anything still counted after a minute lost its terminal event. Ageing those
// out matters because the count also gates admission — a stuck counter would wedge the demo at "full" for everyone.
const PENDING_TTL_MS = 60_000;
const pendingSince: number[] = [];

function pendingJobs(): number {
  const cutoff = Date.now() - PENDING_TTL_MS;
  while (pendingSince.length > 0 && pendingSince[0]! < cutoff) {
    pendingSince.shift();
  }
  return pendingSince.length;
}

mochiEvents.on('queue:added', (e) => {
  if (e.queue === QUEUE_NAME) {
    pendingSince.push(Date.now());
  }
});
const settle = (e: { queue: string }) => {
  if (e.queue === QUEUE_NAME) {
    pendingSince.shift();
  }
};
mochiEvents.on('queue:completed', settle);
mochiEvents.on('queue:failed', settle);

// The site rides the default `queueStorage: 'memory'`, so the demo writes no queue file into the working dir;
// set `Mochi.serve({ queueStorage })` to persist.
export const notificationQueue = Mochi.queue<NotificationJob>(QUEUE_NAME, {
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

// `add()` awaits the queue write before `queue:added` fires, so concurrent submissions need the reservation to see
// each other during that window; the reservation is released once the event has taken over the count.
export function reserveNotificationSlot(): (() => void) | null {
  if (pendingJobs() + reservations >= MAX_PENDING_NOTIFICATION_JOBS) {
    return null;
  }
  reservations++;
  let released = false;
  return () => {
    if (!released) {
      reservations = Math.max(0, reservations - 1);
      released = true;
    }
  };
}

export async function enqueueNotification(data: NotificationJob): Promise<boolean> {
  const release = reserveNotificationSlot();
  if (!release) {
    return false;
  }
  try {
    await notificationQueue.add(data);
    return true;
  } finally {
    release();
  }
}

export function queueStatus(): QueueStatus {
  return { processed: [...processed].reverse(), processedTotal, inFlight: pendingJobs() };
}
