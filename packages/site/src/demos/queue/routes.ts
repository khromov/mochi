import { Mochi, success, mochiEvents } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { notificationQueue, queueStatus, QUEUE_NAME } from './queue.server';
import { randomUsername } from './usernames';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/queue': Mochi.page('./src/demos/queue/Queue.svelte', {
    // Initial state for the first render / hydration; the SSE stream below keeps
    // it live thereafter. `suggestedUser` is generated server-side so SSR and
    // hydration agree on the preloaded value.
    serverProps: () => ({ initial: queueStatus(), suggestedUser: randomUsername() }),
    actions: {
      enqueue: async ({ formData }) => {
        // Accept any free-text username. It is stored as-is and only ever
        // rendered through Svelte text interpolation (`{entry.user}`), which
        // auto-escapes — so arbitrary input can't inject markup. Cap the length
        // to keep the UI tidy.
        const user = String(formData.get('username') ?? '')
          .trim()
          .slice(0, 64);
        const ref = await notificationQueue.add('notify', { user: user || 'anonymous' });
        return success({ queued: user || 'anonymous', jobId: ref.id });
      },
    },
  }),
  // Push the latest status whenever a job in this queue completes.
  '/demos/queue/events': Mochi.sse((stream) => {
    const push = (event: { queue: string }) => {
      if (event.queue === QUEUE_NAME) {
        stream.send(JSON.stringify(queueStatus()));
      }
    };
    mochiEvents.on('queue:completed', push);
    stream.onClose(() => mochiEvents.off('queue:completed', push));
  }),
};
