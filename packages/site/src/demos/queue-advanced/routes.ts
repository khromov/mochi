import { Mochi, success } from 'mochi-framework';
import type { MochiRouteValue, MochiQueueConfig } from 'mochi-framework';
import {
  WEBHOOKS_QUEUE,
  DLQ_QUEUE,
  DIGEST_QUEUE,
  webhooksQueue,
  dlqQueue,
  digestQueue,
  demoStatus,
  onDemoEvent,
  recordSuppressed,
  recordDelayedAdd,
  recordRedrive,
  seedDlqDepth,
} from './queueAdvanced.server';
import type { WebhookJob, DigestJob, WebhookMode } from './types';

// Mounted in the site's Mochi.serve({ queues }) call — see src/routes.ts.
export const queues: Record<string, MochiQueueConfig> = {
  [WEBHOOKS_QUEUE]: webhooksQueue,
  [DLQ_QUEUE]: dlqQueue,
  [DIGEST_QUEUE]: digestQueue,
};

const webhooks = () => Mochi.getQueue<WebhookJob>(WEBHOOKS_QUEUE);
const digest = () => Mochi.getQueue<DigestJob>(DIGEST_QUEUE);

let batchCounter = 0;

export const routes: Record<string, MochiRouteValue> = {
  '/demos/queue-advanced': Mochi.page('./src/demos/queue-advanced/QueueAdvanced.svelte', {
    serverProps: async () => {
      await seedDlqDepth();
      return { initial: demoStatus() };
    },
    actions: {
      deliver: async ({ formData }) => {
        const mode = String(formData.get('mode')) as WebhookMode;
        const jobId = await webhooks().add({ url: `https://example.com/${mode}`, mode });
        return success({ jobId });
      },
      delayed: async () => {
        const jobId = await webhooks().add({ url: 'https://example.com/later', mode: 'ok' }, { startAfter: 5 });
        if (jobId) {
          recordDelayedAdd(jobId, 5);
        }
        return success({ jobId });
      },
      priorityBatch: async () => {
        const batch = ++batchCounter;
        // Enqueued lowest-priority-first; the workers still pick highest first — watch the `active` order in the log.
        const priorities = [0, 1, 5, 10];
        const ids = await webhooks().addBulk(
          priorities.map((priority) => ({ data: { url: `https://example.com/batch-${batch}/p${priority}`, mode: 'ok' as const, priority }, opts: { priority } })),
        );
        return success({ jobIds: ids });
      },
      throttled: async () => {
        const jobId = await digest().addThrottled({ requestedAt: Date.now() }, 10, 'demo-digest');
        if (jobId === null) {
          recordSuppressed(DIGEST_QUEUE, 'addThrottled resolved null — the 10s slot already has a job');
        }
        return success({ jobId });
      },
      debounced: async () => {
        const jobId = await digest().addDebounced({ requestedAt: Date.now() }, 10, 'demo-digest-debounce');
        if (jobId === null) {
          recordSuppressed(DIGEST_QUEUE, 'addDebounced resolved null — current and next 10s slots are both booked');
        }
        return success({ jobId });
      },
      redrive: async () => {
        // The escape hatch: everything Mochi doesn't wrap lives on the shared bun-boss instance.
        const moved = await Mochi.boss().redrive(DLQ_QUEUE);
        recordRedrive(moved);
        return success({ moved });
      },
    },
  }),
  '/demos/queue-advanced/events': Mochi.sse((stream) => {
    const send = () => stream.send(JSON.stringify(demoStatus()));
    send();
    const off = onDemoEvent(send);
    stream.onClose(off);
  }),
};
