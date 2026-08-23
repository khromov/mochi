import { Mochi, fail, success, mochiEvents } from 'mochi-framework';
import type { MochiRouteValue, MochiQueueConfig } from 'mochi-framework';
import { enqueueNotification, notificationQueue, queueStatus, QUEUE_NAME } from './queue.server';
import { randomUsername } from './usernames';

// Mounted in the site's Mochi.serve({ queues }) call — see src/routes.ts.
export const queues: MochiQueueConfig[] = [notificationQueue];

export const routes: Record<string, MochiRouteValue> = {
  '/demos/queue': Mochi.page('./src/demos/queue/Queue.svelte', {
    rateLimit: { limit: 30, window: '1m', skip: (req) => req.method !== 'POST' },
    // `suggestedUser` is generated server-side so SSR and hydration agree.
    serverProps: () => ({ initial: queueStatus(), suggestedUser: randomUsername() }),
    actions: {
      enqueue: async ({ formData }) => {
        // Free-text username is safe unsanitized: it's only ever rendered through
        // Svelte text interpolation (`{entry.user}`), which auto-escapes.
        const user = String(formData.get('username') ?? '')
          .trim()
          .slice(0, 64);
        if (!(await enqueueNotification({ user: user || 'anonymous' }))) {
          return fail(503, { error: 'The demo queue is full. Try again after some jobs finish.' });
        }
        return success({ queued: user || 'anonymous' });
      },
    },
  }),
  '/demos/queue/events': Mochi.sse((stream) => {
    // Broadcast the shared snapshot on enqueue and on settle, so every client's
    // in-flight/processed counts move together — no per-client reconciliation.
    const push = (event: { queue: string }) => {
      if (event.queue === QUEUE_NAME) {
        stream.send(JSON.stringify(queueStatus()));
      }
    };
    mochiEvents.on('queue:added', push);
    mochiEvents.on('queue:completed', push);
    mochiEvents.on('queue:failed', push);
    stream.onClose(() => {
      mochiEvents.off('queue:added', push);
      mochiEvents.off('queue:completed', push);
      mochiEvents.off('queue:failed', push);
    });
  }),
};
