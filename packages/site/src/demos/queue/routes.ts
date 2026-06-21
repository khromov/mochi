import { Mochi, success, json } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { emailQueue, queueStatus } from './queue';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/queue': Mochi.page('./src/demos/queue/Queue.svelte', {
    actions: {
      enqueue: async ({ formData }) => {
        const to = String(formData.get('to') ?? '').trim() || 'someone@example.com';
        const ref = await emailQueue.add('send', { to });
        return success({ queued: to, jobId: ref.id });
      },
    },
  }),
  '/demos/queue/status': Mochi.api(() => json(queueStatus())),
};
