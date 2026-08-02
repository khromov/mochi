import { Mochi, defineJobTypes, mochiEvents } from 'mochi-framework';
import type { ProcessedEntry, QueueStatus } from './types';

/** The chain's entry type name — what `queue:*` events carry as their `queue` field. */
export const CHAIN_TYPE = 'send-notification';

// `inFlight` is tracked off the event bus, not per request, so every connected browser sees the same numbers. A chain
// is in flight from its entry job's `queue:added` until its final job settles.
const processed: ProcessedEntry[] = [];
let processedTotal = 0;
let inFlight = 0;

mochiEvents.on('queue:added', (e) => {
  if (e.queue === CHAIN_TYPE && e.jobName === CHAIN_TYPE) {
    inFlight++;
  }
});
mochiEvents.on('queue:completed', (e) => {
  if (e.queue === CHAIN_TYPE && e.jobName === 'record-receipt') {
    inFlight = Math.max(0, inFlight - 1);
  }
});
mochiEvents.on('queue:failed', (e) => {
  if (e.queue === CHAIN_TYPE) {
    inFlight = Math.max(0, inFlight - 1);
  }
});

// Memory backend (the default) so the demo writes no database file into the site working dir — swap `backend` for
// `{ kind: 'sqlite', path: … }` or `{ kind: 'postgres', url: … }` to make chains durable across restarts.
export const notificationJobs = Mochi.jobs({
  concurrency: 2,
  types: defineJobTypes<{
    'send-notification': {
      entry: true;
      input: { user: string };
      continueWith: { typeName: 'record-receipt' };
    };
    'record-receipt': {
      input: { user: string; startedAt: number };
      output: { delivered: boolean };
    };
  }>(),
  processors: {
    'send-notification': {
      attemptHandler: async ({ job, complete }) => {
        // Simulate delivery latency so the UI shows the queued → processing → done transition.
        const startedAt = Date.now();
        await Bun.sleep(500 + Math.random() * 1500);
        return complete(async ({ continueWith }) => continueWith({ typeName: 'record-receipt', input: { user: job.input.user, startedAt } }));
      },
    },
    'record-receipt': {
      attemptHandler: async ({ job, complete }) =>
        complete(async () => {
          processed.push({ user: job.input.user, at: Date.now(), ms: Date.now() - job.input.startedAt });
          if (processed.length > 20) {
            processed.shift();
          }
          processedTotal++;
          return { delivered: true };
        }),
    },
  },
});

export function queueStatus(): QueueStatus {
  return { processed: [...processed].reverse(), processedTotal, inFlight };
}
