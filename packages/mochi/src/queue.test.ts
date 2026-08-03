import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createQueue, getQueue, closeAllQueueResources, runQueueRecovery } from './queue';
import type { MochiJob, MochiQueueBackend } from './queue';
import type { MochiQueueFailedEvent } from './events';
import { mochiEvents } from './events';
import { initExtensions } from './extensions';
import { setLogLevel } from './utils/log';
import { markStartupMilestone, resetStartupMilestones } from './lifecycle';

const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-queue-test-'));
const sqlitePath = path.join(dataDir, 'queue.sqlite');

// Underscores so queue names survive table-name sanitization unchanged; unique per test so tables never collide.
let counter = 0;
const uniqueName = (): string => `q_${counter++}`;

// One shared db file (a backend maps each queue to its own table); factories so each test resolves the backend fresh.
const BACKENDS: Array<{ label: string; backend: () => MochiQueueBackend }> = [
  { label: 'memory', backend: () => 'memory' },
  { label: 'sqlite', backend: () => ({ sqlite: sqlitePath, fedify: { pollInterval: { milliseconds: 50 } } }) },
];

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(async () => {
  mochiEvents.all.clear();
  resetStartupMilestones();
  await closeAllQueueResources();
});

afterAll(async () => {
  // The last afterEach closes the shared sqlite handle, but Windows releases the
  // underlying SQLite file lock asynchronously, so an immediate rm throws EBUSY.
  // (Bun ignores rmSync's maxRetries option, so retry by hand.) This is
  // best-effort cleanup of an ephemeral temp dir — never fail the suite over it,
  // so give up quietly once the budget is exhausted; the OS reclaims it on
  // process exit regardless.
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
});

describe.each(BACKENDS)('Mochi queue ($label)', ({ backend }) => {
  test('roundtrips a job from producer to consumer', async () => {
    const name = uniqueName();
    const seen = deferred<MochiJob<{ to: string }>>();

    const queue = await createQueue<{ to: string }>(
      name,
      async (job) => {
        seen.resolve(job);
        return { sent: true };
      },
      { backend: backend() },
    );

    const ref = await queue.add('send', { to: 'alice@example.com' });
    expect(ref.id).toBeString();
    expect(ref.name).toBe('send');

    const job = await seen.promise;
    expect(job.data).toEqual({ to: 'alice@example.com' });
    expect(job.name).toBe('send');
    expect(job.queue).toBe(name);
    expect(job.attempt).toBe(1);
    expect(job.id).toBe(ref.id);
  });

  test('addBulk enqueues every job', async () => {
    const name = uniqueName();
    let processed = 0;
    const done = deferred<void>();

    const queue = await createQueue<{ n: number }>(
      name,
      async () => {
        if (++processed === 3) {
          done.resolve();
        }
      },
      { backend: backend() },
    );

    const refs = await queue.addBulk([
      { name: 'job', data: { n: 1 } },
      { name: 'job', data: { n: 2 } },
      { name: 'job', data: { n: 3 } },
    ]);

    expect(refs).toHaveLength(3);
    await done.promise;
    expect(processed).toBe(3);
  });

  test('respects concurrency', async () => {
    const name = uniqueName();
    let active = 0;
    let maxActive = 0;
    let completed = 0;
    const allDone = deferred<void>();

    const queue = await createQueue<{ i: number }>(
      name,
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(80);
        active--;
        if (++completed === 4) {
          allDone.resolve();
        }
      },
      { backend: backend(), concurrency: 2 },
    );

    await queue.addBulk([0, 1, 2, 3].map((i) => ({ name: 'job', data: { i } })));

    await allDone.promise;
    // Concurrency caps in-flight jobs at 2; assert the ceiling held and that more
    // than one ran at once, without depending on the exact timing of when all four
    // jobs were enqueued vs. drained.
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(1);
  });

  test('emits queue:* lifecycle events on the mochi bus', async () => {
    const name = uniqueName();
    const added: unknown[] = [];
    const active: unknown[] = [];
    const completed = deferred<{ queue: string; jobName: string; attempt: number; duration: number }>();

    mochiEvents.on('queue:added', (e) => added.push(e));
    mochiEvents.on('queue:active', (e) => active.push(e));
    mochiEvents.on('queue:completed', (e) => completed.resolve(e));

    const queue = await createQueue<{ x: number }>(name, async () => ({ ok: true }), { backend: backend() });
    await queue.add('compute', { x: 1 });

    const done = await completed.promise;
    expect(added).toHaveLength(1);
    expect(active).toHaveLength(1);
    expect(done.queue).toBe(name);
    expect(done.jobName).toBe('compute');
    expect(done.attempt).toBe(1);
    expect(done.duration).toBeGreaterThanOrEqual(0);
  });

  test('reports failures via queue:failed and the on.failed listener', async () => {
    const name = uniqueName();
    const failedEvent = deferred<MochiQueueFailedEvent>();
    const failedListener = deferred<Error>();

    mochiEvents.on('queue:failed', (e) => failedEvent.resolve(e));

    const queue = await createQueue<{ y: number }>(
      name,
      async () => {
        throw new Error('boom');
      },
      { backend: backend() },
      { failed: (_job, error) => failedListener.resolve(error) },
    );

    await queue.add('explode', { y: 1 }, { attempts: 1 });

    const event = await failedEvent.promise;
    expect(event.error).toBe('boom');
    expect(event.attempt).toBe(1);
    expect(event.willRetry).toBe(false);

    const error = await failedListener.promise;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('boom');
  });

  test('retries a failing job up to attempts with backoff, flagging willRetry', async () => {
    const name = uniqueName();
    const failures: MochiQueueFailedEvent[] = [];
    const exhausted = deferred<void>();
    const attemptsSeen: number[] = [];

    mochiEvents.on('queue:failed', (e) => {
      failures.push(e);
      if (!e.willRetry) {
        exhausted.resolve();
      }
    });

    const queue = await createQueue<{ n: number }>(
      name,
      async (job) => {
        attemptsSeen.push(job.attempt);
        throw new Error(`fail #${job.attempt}`);
      },
      { backend: backend(), backoff: { type: 'fixed', delay: 10 } },
    );

    await queue.add('retry-me', { n: 1 }, { attempts: 3 });

    await exhausted.promise;
    expect(attemptsSeen).toEqual([1, 2, 3]);
    expect(failures.map((f) => f.attempt)).toEqual([1, 2, 3]);
    expect(failures.map((f) => f.willRetry)).toEqual([true, true, false]);
  });

  test('a delayed job does not run before its delay elapses', async () => {
    const name = uniqueName();
    const ran = deferred<number>();

    const queue = await createQueue<{ v: number }>(
      name,
      async () => {
        ran.resolve(performance.now());
      },
      { backend: backend() },
    );

    const enqueuedAt = performance.now();
    await queue.add('later', { v: 1 }, { delay: 150 });

    const startedAt = await ran.promise;
    expect(startedAt - enqueuedAt).toBeGreaterThanOrEqual(140);
  });

  test('jobs sharing an orderingKey run sequentially in enqueue order at concurrency 1', async () => {
    const name = uniqueName();
    const order: number[] = [];
    const done = deferred<void>();

    const queue = await createQueue<{ seq: number }>(
      name,
      async (job) => {
        order.push(job.data.seq);
        if (order.length === 3) {
          done.resolve();
        }
      },
      { backend: backend(), concurrency: 1 },
    );

    await queue.add('step', { seq: 1 }, { orderingKey: 'chain' });
    await queue.add('step', { seq: 2 }, { orderingKey: 'chain' });
    await queue.add('step', { seq: 3 }, { orderingKey: 'chain' });

    await done.promise;
    expect(order).toEqual([1, 2, 3]);
  });

  test('depth() reports what is waiting in the store', async () => {
    const name = uniqueName();
    const queue = await createQueue(name, async () => null, { backend: backend() });

    // A far-future delayed job stays in the store, so the count is deterministic
    // even though the listen loop is already draining ready messages.
    await queue.add('someday', { v: 1 }, { delay: 60_000 });

    const depth = await queue.depth();
    expect(depth).toBeDefined();
    expect(depth!.queued).toBe(1);
    expect(depth!.delayed).toBe(1);
    expect(depth!.ready).toBe(0);
  });

  test('does not leak backend message internals into the processor', async () => {
    const name = uniqueName();
    const seen = deferred<MochiJob<unknown>>();

    const queue = await createQueue(
      name,
      async (job) => {
        seen.resolve(job);
        return null;
      },
      { backend: backend() },
    );

    await queue.add('probe', { hello: 'world' });

    const job = await seen.promise;
    expect((job as unknown as Record<string, unknown>).__mochi).toBeUndefined();
    expect((job as unknown as Record<string, unknown>).attempts).toBeUndefined();
    expect(Object.keys(job).sort()).toEqual(['attempt', 'data', 'enqueuedAt', 'id', 'name', 'queue']);
  });

  test('closeAllQueueResources drains an in-flight job before closing the store', async () => {
    const name = uniqueName();
    const started = deferred<void>();
    let finished = false;

    const queue = await createQueue(
      name,
      async () => {
        started.resolve();
        await Bun.sleep(120);
        finished = true;
      },
      { backend: backend() },
    );

    await queue.add('slow', { v: 1 });
    await started.promise;
    await closeAllQueueResources();
    expect(finished).toBe(true);
  });
});

// Backend-independent behavior (registry, recovery, lifecycle errors) runs once on the memory backend.
describe('Mochi queue', () => {
  test('a raw MessageQueue instance works as a backend, and depth() is undefined without getDepth', async () => {
    const name = uniqueName();
    const seen = deferred<MochiJob<{ v: number }>>();

    // Minimal fedify-shaped transport: no delay support, no getDepth.
    const messages: unknown[] = [];
    let notify: (() => void) | null = null;
    const rawQueue = {
      async enqueue(message: unknown) {
        messages.push(message);
        notify?.();
      },
      async listen(handler: (message: unknown) => Promise<void> | void, options: { signal?: AbortSignal } = {}) {
        while (!options.signal?.aborted) {
          if (messages.length > 0) {
            await handler(messages.shift());
            continue;
          }
          await new Promise<void>((resolve) => {
            notify = resolve;
            options.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          notify = null;
        }
      },
    };

    const queue = await createQueue<{ v: number }>(
      name,
      async (job) => {
        seen.resolve(job);
      },
      { backend: rawQueue },
    );

    await queue.add('custom', { v: 42 });
    const job = await seen.promise;
    expect(job.data).toEqual({ v: 42 });
    expect(await queue.depth()).toBeUndefined();

    // The same instance cannot back a second queue — its single listen loop would steal messages.
    expect(createQueue(uniqueName(), async () => null, { backend: rawQueue })).rejects.toThrow(/already backs another queue/);
  });

  test('a non-Mochi message on the store is dropped with a queue:error', async () => {
    const name = uniqueName();
    const errors: Array<{ queue: string; error: string }> = [];
    let processed = 0;
    mochiEvents.on('queue:error', (e) => errors.push(e));

    let notify: (() => void) | null = null;
    const messages: unknown[] = [];
    const rawQueue = {
      async enqueue(message: unknown) {
        messages.push(message);
        notify?.();
      },
      async listen(handler: (message: unknown) => Promise<void> | void, options: { signal?: AbortSignal } = {}) {
        while (!options.signal?.aborted) {
          if (messages.length > 0) {
            await handler(messages.shift());
            continue;
          }
          await new Promise<void>((resolve) => {
            notify = resolve;
            options.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          notify = null;
        }
      },
    };

    await createQueue(
      name,
      async () => {
        processed++;
      },
      { backend: rawQueue },
    );

    // A foreign producer writing to the same store bypasses Mochi's envelope.
    await rawQueue.enqueue({ some: 'foreign payload' });
    await Bun.sleep(20);

    expect(processed).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.queue).toBe(name);
    expect(errors[0]!.error).toMatch(/non-Mochi message/);
  });

  test('two queue names that sanitize to the same table are rejected', async () => {
    const first = await createQueue('collide me', async () => null, { backend: { sqlite: sqlitePath } });
    expect(first.name).toBe('collide me');
    expect(createQueue('collide_me', async () => null, { backend: { sqlite: sqlitePath } })).rejects.toThrow(/both map to backend table/);
  });

  test('a job persisted by the sqlite backend survives a close and remount', async () => {
    const name = uniqueName();
    const backend: MochiQueueBackend = { sqlite: sqlitePath, fedify: { pollInterval: { milliseconds: 50 } } };

    const before = await createQueue(name, async () => null, { backend });
    // Far enough out that the first mount cannot deliver it before we close.
    await before.add('survivor', { v: 1 }, { delay: 300 });
    await closeAllQueueResources();

    const seen = deferred<MochiJob<unknown>>();
    await createQueue(
      name,
      async (job) => {
        seen.resolve(job);
      },
      { backend },
    );

    const job = await seen.promise;
    expect(job.name).toBe('survivor');
    expect(job.data).toEqual({ v: 1 });
  });

  test('getQueue resolves the producer handle created for a name', async () => {
    const name = uniqueName();
    const created = await createQueue(name, async () => null, {});
    expect(getQueue(name)).toBe(created);
  });

  // The mount milestone is what separates "too early" from "wrong name" — see
  // getQueue in ./queue.ts. These tests never run Mochi.serve(), so the
  // milestone is unset and every lookup is legitimately "too early".
  test('getQueue blames the lifecycle, not a typo, before queues are mounted', () => {
    expect(() => getQueue('never-declared')).toThrow(/queues are not mounted yet/);
    expect(() => getQueue('never-declared')).toThrow(/mochi:init/);
  });

  test('getQueue names the mounted queues once mounting finished', async () => {
    const name = uniqueName();
    await createQueue(name, async () => null, {});
    markStartupMilestone('mochi:queuesMounted');
    expect(() => getQueue('typoed')).toThrow(/no such queue/);
    expect(() => getQueue('typoed')).toThrow(new RegExp(`Mounted queues: ${name}`));
  });

  test('getQueue says so when serve mounted no queues at all', () => {
    markStartupMilestone('mochi:queuesMounted');
    expect(() => getQueue('emails')).toThrow(/no queues were declared/);
  });

  test('runQueueRecovery hands each callback its own producer handle', async () => {
    const name = uniqueName();
    const created = await createQueue(name, async () => null, {});
    let received: unknown;
    await runQueueRecovery([[name, { recover: (queue) => void (received = queue) }]]);
    expect(received).toBe(created);
  });

  test('a throwing recover is contained and reported on the event bus', async () => {
    const name = uniqueName();
    await createQueue(name, async () => null, {});
    const errors: Array<{ queue: string; error: string }> = [];
    mochiEvents.on('queue:error', (e) => errors.push(e));

    await runQueueRecovery([
      [
        name,
        {
          recover: () => {
            throw new Error('store unavailable');
          },
        },
      ],
    ]);

    expect(errors).toEqual([{ queue: name, error: 'store unavailable' }]);
  });

  // Behavioural coverage for the `queue:recoveryStallWarningMs` filter: the
  // real threshold is 30s, so these drive it down far enough to observe.
  async function recoveryWarnings(stallMs: number | null): Promise<string[]> {
    const name = uniqueName();
    await createQueue(name, async () => null, {});
    initExtensions(stallMs === null ? {} : { filters: { 'queue:recoveryStallWarningMs': () => stallMs } });

    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
    setLogLevel('warn');
    try {
      await runQueueRecovery([[name, { recover: () => Bun.sleep(60) }]]);
    } finally {
      console.warn = realWarn;
      initExtensions({});
    }
    return warnings;
  }

  test('a recover() slower than the filtered threshold warns that serve() is blocked', async () => {
    const warnings = await recoveryWarnings(10);
    expect(warnings.some((line) => line.includes('recover() is still running'))).toBe(true);
  });

  test('a filtered threshold of 0 silences the stall warning', async () => {
    // The recover() is the same 60ms one that warns above, so a quiet run can
    // only be the opt-out taking effect.
    const warnings = await recoveryWarnings(0);
    expect(warnings.some((line) => line.includes('recover() is still running'))).toBe(false);
  });

  test('the default threshold does not warn about a fast recover()', async () => {
    const warnings = await recoveryWarnings(null);
    expect(warnings).toEqual([]);
  });

  test('closeAllQueueResources closes resources and is idempotent', async () => {
    const name = uniqueName();
    await createQueue(name, async () => null, {});

    await closeAllQueueResources();
    // After draining, the handle is gone from the registry.
    expect(() => getQueue(name)).toThrow(/queues are not mounted yet/);
    // A second call must not throw even though the registry is already empty.
    await closeAllQueueResources();
    expect(true).toBe(true);
  });
});
