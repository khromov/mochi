import { Mochi, logger, mochiEvents } from 'mochi-framework';
import type { MochiQueueConfig, MochiQueueStorage } from 'mochi-framework';
import type { DemoLogEntry, DemoLogKind, QueueAdvancedStatus, WebhookJob, DigestJob } from './types';

export const WEBHOOKS_QUEUE = 'demo-webhooks';
export const DLQ_QUEUE = 'demo-webhooks-dlq';
export const DIGEST_QUEUE = 'demo-digest';

// One store serves every queue in the process, so the flag lives at the serve level (src/index.ts imports these).
// QUEUE_STORAGE=memory (default) | sqlite | postgres — postgres reads DATABASE_URL.
export const queueStorage: MochiQueueStorage =
  process.env.QUEUE_STORAGE === 'sqlite'
    ? { sqlite: '.mochi/queue-demo.sqlite' }
    : process.env.QUEUE_STORAGE === 'postgres'
      ? { postgres: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres' }
      : 'memory';

export const queueStorageLabel = typeof queueStorage === 'string' ? 'memory' : 'sqlite' in queueStorage ? `sqlite (${queueStorage.sqlite})` : 'postgres';

const RETRY_LIMIT = 2; // up to 3 runs; shared with the processor's terminal-attempt log line

const MAX_LOG = 40;
const entries: DemoLogEntry[] = [];
let seq = 0;
let dlqDepth = 0;
const listeners = new Set<() => void>();

// Every demo event goes to the server console (via logger) AND the ring buffer the SSE stream pushes to browsers,
// so the terminal and the page tell the same story.
function push(kind: DemoLogKind, queue: string, detail: string, jobId?: string, attempt?: number): void {
  entries.push({ id: ++seq, at: Date.now(), kind, queue, jobId, attempt, detail });
  if (entries.length > MAX_LOG) {
    entries.shift();
  }
  const ref = jobId ? ` #${jobId.slice(0, 8)}` : '';
  const nth = attempt ? ` (attempt ${attempt})` : '';
  logger.info(`[queue-demo] ${kind}: ${queue}${ref}${nth} — ${detail}`);
  for (const listener of listeners) {
    listener();
  }
}

export function onDemoEvent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function demoStatus(): QueueAdvancedStatus {
  return { storage: queueStorageLabel, dlqDepth, log: [...entries].reverse() };
}

let dlqSeeded = false;

// With durable storage the DLQ can hold jobs from a previous run, so the in-memory depth counter
// seeds from the store on the first page view instead of starting at 0.
export async function seedDlqDepth(): Promise<void> {
  if (dlqSeeded) {
    return;
  }
  dlqSeeded = true;
  const stranded = await Mochi.boss().findJobs(DLQ_QUEUE, { queued: true });
  if (stranded.length > 0) {
    dlqDepth = stranded.length;
    push('info', DLQ_QUEUE, `${stranded.length} job(s) found in the dead-letter queue from a previous run — durable storage at work`);
  }
}

export function recordSuppressed(queue: string, what: string): void {
  push('suppressed', queue, what);
}

export function recordDelayedAdd(jobId: string, seconds: number): void {
  push('info', WEBHOOKS_QUEUE, `deferred ${seconds}s — watch it turn active on a later poll`, jobId);
}

export function recordRedrive(moved: number): void {
  dlqDepth = Math.max(0, dlqDepth - moved);
  push('redrive', DLQ_QUEUE, `${moved} job(s) moved back to ${WEBHOOKS_QUEUE}`);
}

const DEMO_QUEUES = new Set([WEBHOOKS_QUEUE, DLQ_QUEUE, DIGEST_QUEUE]);

// setHandler, not on(): dev re-imports of this module must replace these subscriptions, not stack them.
mochiEvents.setHandler('queue-advanced-demo:added', 'queue:added', (e) => {
  if (DEMO_QUEUES.has(e.queue)) {
    push('added', e.queue, 'enqueued', e.jobId);
  }
});
mochiEvents.setHandler('queue-advanced-demo:active', 'queue:active', (e) => {
  if (DEMO_QUEUES.has(e.queue)) {
    push('active', e.queue, 'picked up by worker', e.jobId, e.attempt);
  }
});
mochiEvents.setHandler('queue-advanced-demo:completed', 'queue:completed', (e) => {
  if (DEMO_QUEUES.has(e.queue)) {
    push('completed', e.queue, `done in ${Math.round(e.duration)}ms`, e.jobId, e.attempt);
  }
});
mochiEvents.setHandler('queue-advanced-demo:failed', 'queue:failed', (e) => {
  if (!DEMO_QUEUES.has(e.queue)) {
    return;
  }
  const terminal = e.queue === WEBHOOKS_QUEUE && e.attempt > RETRY_LIMIT;
  push('failed', e.queue, `${e.error}${terminal ? '' : ` — retrying with backoff`}`, e.jobId, e.attempt);
  // The move to the dead-letter queue is internal to the store (no bus event), so the demo infers it
  // from the terminal failure of a queue that declares deadLetter.
  if (terminal) {
    dlqDepth++;
    push('dlq', DLQ_QUEUE, `retries exhausted — job moved here (depth ${dlqDepth})`, e.jobId);
  }
});

export const webhooksQueue: MochiQueueConfig = Mochi.queue<WebhookJob>({
  concurrency: 2,
  pollingIntervalSeconds: 0.5,
  retryLimit: RETRY_LIMIT,
  retryDelay: 2,
  retryBackoff: true,
  deadLetter: DLQ_QUEUE,
  process: async (job) => {
    await Bun.sleep(300);
    if (job.data.mode === 'doomed') {
      throw new Error(`delivery to ${job.data.url} refused`);
    }
    if (job.data.mode === 'flaky' && job.attempt === 1) {
      throw new Error('connection reset (transient)');
    }
    return { delivered: true, url: job.data.url };
  },
});

// No `process`: a holding pen. Terminally failed webhooks land here for inspection until the
// redrive action moves them back.
export const dlqQueue: MochiQueueConfig = Mochi.queue({});

export const digestQueue: MochiQueueConfig = Mochi.queue<DigestJob>({
  pollingIntervalSeconds: 0.5,
  process: async (job) => {
    await Bun.sleep(200);
    return { compiled: true, waitedMs: Date.now() - job.data.requestedAt };
  },
});
