import { Mochi } from 'mochi-framework';
import type { MochiQueue } from 'mochi-framework';
import type { NotificationJob, ProcessedEntry, QueueStatus } from './types';

export const QUEUE_NAME = 'demo-notifications';

interface DemoQueue {
  queue: MochiQueue<NotificationJob>;
  processed: ProcessedEntry[];
  total: number;
}

// This module owns process singletons — a queue handle, a worker, and the
// in-memory results. In dev, Mochi re-bundles and re-executes routes.ts (and
// thus this module) to hot-swap routes, so the module body can run more than
// once per process. Pin the singletons to globalThis so they're created exactly
// once and every copy shares the same queue, worker, and state — otherwise the
// worker writes one copy of `processed` while the route reads another. Same
// pattern the framework uses for mochiEvents / requestContext.
const globalRef = globalThis as unknown as { __mochiQueueDemo?: DemoQueue };

function createDemoQueue(): DemoQueue {
  const state: DemoQueue = {
    // In-memory (no dataPath) so the demo writes no SQLite file; jobs don't
    // survive a restart, which is fine here.
    queue: Mochi.queue<NotificationJob>(QUEUE_NAME),
    processed: [],
    total: 0,
  };
  Mochi.worker<NotificationJob>(
    QUEUE_NAME,
    async (job) => {
      // Simulate the latency of actually delivering a notification so the UI
      // shows the queued → processing → done transition.
      await Bun.sleep(700);
      state.processed.push({ user: job.data.user, at: Date.now() });
      if (state.processed.length > 20) {
        state.processed.shift();
      }
      state.total++;
      return { delivered: true };
    },
    { concurrency: 2 },
  );
  return state;
}

const demo: DemoQueue = (globalRef.__mochiQueueDemo ??= createDemoQueue());

export const notificationQueue = demo.queue;

export function queueStatus(): QueueStatus {
  return { processed: [...demo.processed].reverse(), processedTotal: demo.total };
}
