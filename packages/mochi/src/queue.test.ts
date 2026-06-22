import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createQueue, createWorker, closeAllQueueResources, unconsumedQueueNames } from './queue';
import type { MochiJob } from './queue';
import { mochiEvents } from './events';
import { logger } from './log';

// bunqueue locks its embedded store to the first dataPath used in the process,
// so the whole file shares one temp dir and each test uses a unique queue name.
const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-queue-test-'));
const dataPath = path.join(dataDir, 'queue.sqlite');

let counter = 0;
const uniqueName = (): string => `q-${counter++}`;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(async () => {
  mochiEvents.all.clear();
  await closeAllQueueResources();
});

afterAll(async () => {
  // The last afterEach closes bunqueue's embedded store (shutdownManager ->
  // storage.close()), but Windows releases the underlying SQLite file lock
  // asynchronously, so an immediate rm throws EBUSY. (Bun ignores rmSync's
  // maxRetries option, so retry by hand.) This is best-effort cleanup of an
  // ephemeral temp dir — never fail the suite over it, so give up quietly once
  // the budget is exhausted; the OS reclaims it on process exit regardless.
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
});

describe('Mochi queue + worker', () => {
  test('roundtrips a job from producer to worker', async () => {
    const name = uniqueName();
    const seen = deferred<MochiJob<{ to: string }>>();

    createWorker<{ to: string }>(
      name,
      async (job) => {
        seen.resolve(job);
        return { sent: true };
      },
      { dataPath },
    );

    const queue = createQueue<{ to: string }>(name, { dataPath });
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

    createWorker<{ n: number }>(
      name,
      async () => {
        if (++processed === 3) {
          done.resolve();
        }
      },
      { dataPath },
    );

    const queue = createQueue<{ n: number }>(name, { dataPath });
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

    createWorker<{ i: number }>(
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
      { dataPath, concurrency: 2 },
    );

    const queue = createQueue<{ i: number }>(name, { dataPath });
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

    createWorker<{ x: number }>(name, async () => ({ ok: true }), { dataPath });
    const queue = createQueue<{ x: number }>(name, { dataPath });
    await queue.add('compute', { x: 1 });

    const done = await completed.promise;
    expect(added).toHaveLength(1);
    expect(active).toHaveLength(1);
    expect(done.queue).toBe(name);
    expect(done.jobName).toBe('compute');
    expect(done.attempt).toBe(1);
    expect(done.duration).toBeGreaterThanOrEqual(0);
  });

  test('reports failures via queue:failed and the worker handle', async () => {
    const name = uniqueName();
    const failedEvent = deferred<{ error: string; attempt: number }>();
    const failedHandle = deferred<Error>();

    mochiEvents.on('queue:failed', (e) => failedEvent.resolve(e));

    const worker = createWorker<{ y: number }>(
      name,
      async () => {
        throw new Error('boom');
      },
      { dataPath },
    );
    worker.on('failed', (_job, error) => failedHandle.resolve(error));

    const queue = createQueue<{ y: number }>(name, { dataPath });
    await queue.add('explode', { y: 1 }, { attempts: 1 });

    const event = await failedEvent.promise;
    expect(event.error).toBe('boom');
    expect(event.attempt).toBe(1);

    const error = await failedHandle.promise;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('boom');
  });

  test('does not leak bunqueue job methods into the processor', async () => {
    const name = uniqueName();
    const seen = deferred<MochiJob<unknown>>();

    createWorker(
      name,
      async (job) => {
        seen.resolve(job);
        return null;
      },
      { dataPath },
    );

    const queue = createQueue(name, { dataPath });
    await queue.add('probe', { hello: 'world' });

    const job = await seen.promise;
    expect((job as unknown as Record<string, unknown>).moveToCompleted).toBeUndefined();
    expect((job as unknown as Record<string, unknown>).updateProgress).toBeUndefined();
    expect(Object.keys(job).sort()).toEqual(['attempt', 'data', 'enqueuedAt', 'id', 'name', 'queue']);
  });

  test('createQueue is idempotent per name (handles do not accumulate)', () => {
    const name = uniqueName();
    const a = createQueue(name, { dataPath });
    const b = createQueue(name, { dataPath });
    const c = createQueue(name, { dataPath });
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  test('createWorker no longer dedupes by name (workers mount once via serve)', () => {
    // Per-name idempotency was removed: workers are instantiated exactly once by
    // Mochi.serve({ workers }), not re-run at module top-level by dev HMR. Each
    // createWorker call now returns a distinct live handle.
    const name = uniqueName();
    const a = createWorker(name, async () => null, { dataPath });
    const b = createWorker(name, async () => null, { dataPath });
    expect(b).not.toBe(a);
  });

  test('closeAllQueueResources closes handles and is idempotent', async () => {
    const name = uniqueName();
    createWorker(name, async () => null, { dataPath });
    createQueue(name, { dataPath });

    await closeAllQueueResources();
    // A second call must not throw even though the registry is already empty.
    await closeAllQueueResources();
    expect(true).toBe(true);
  });

  test('warns once when enqueuing to a queue with no mounted worker', async () => {
    const name = uniqueName();
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const queue = createQueue(name, { dataPath });
      await queue.add('orphan', { x: 1 });
      await queue.add('orphan', { x: 2 });
      const calls = warn.mock.calls.filter((c) => String(c[0]).includes(name));
      expect(calls).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('does not warn when a worker is mounted for the queue', async () => {
    const name = uniqueName();
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      createWorker(name, async () => null, { dataPath });
      const queue = createQueue(name, { dataPath });
      await queue.add('ok', { x: 1 });
      const calls = warn.mock.calls.filter((c) => String(c[0]).includes(name));
      expect(calls).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  test('unconsumedQueueNames flags producers whose name is not in the mounted set', () => {
    const a = uniqueName();
    const b = uniqueName();
    createQueue(a, { dataPath });
    createQueue(b, { dataPath });
    // `a` is about to be mounted, `b` is not — `b` is the orphan.
    expect(unconsumedQueueNames(new Set([a]))).toEqual([b]);
    expect(unconsumedQueueNames(new Set([a, b]))).toEqual([]);
  });
});
