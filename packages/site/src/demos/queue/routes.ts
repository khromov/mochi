import { Mochi, success, mochiEvents } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { notificationJobs, queueStatus, CHAIN_TYPE } from './queue.server';
import { randomUsername } from './usernames';

// Mounted in the site's Mochi.serve({ jobs }) call — see src/routes.ts.
export const jobs = notificationJobs;

export const routes: Record<string, MochiRouteValue> = {
  '/demos/queue': Mochi.page('./src/demos/queue/Queue.svelte', {
    // `suggestedUser` is generated server-side so SSR and hydration agree.
    serverProps: () => ({ initial: queueStatus(), suggestedUser: randomUsername() }),
    actions: {
      enqueue: async ({ formData }) => {
        // Free-text username is safe unsanitized: it's only ever rendered through
        // Svelte text interpolation (`{entry.user}`), which auto-escapes.
        const user = String(formData.get('username') ?? '')
          .trim()
          .slice(0, 64);
        await notificationJobs.startChain({ typeName: 'send-notification', input: { user: user || 'anonymous' } });
        return success({ queued: user || 'anonymous' });
      },
    },
  }),
  '/demos/queue/events': Mochi.sse((stream) => {
    // Broadcast the shared snapshot on enqueue and on settle, so every client's
    // in-flight/processed counts move together — no per-client reconciliation.
    const push = (event: { queue: string }) => {
      if (event.queue === CHAIN_TYPE) {
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
