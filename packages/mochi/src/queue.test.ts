import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createQueue, createWorker, closeAllQueueResources } from './queue';
import type { MochiJob } from './queue';
import { mochiEvents } from './events';

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

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
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
    expect(maxActive).toBe(2);
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

  test('closeAllQueueResources closes handles and is idempotent', async () => {
    const name = uniqueName();
    createWorker(name, async () => null, { dataPath });
    createQueue(name, { dataPath });

    await closeAllQueueResources();
    // A second call must not throw even though the registry is already empty.
    await closeAllQueueResources();
    expect(true).toBe(true);
  });
});
