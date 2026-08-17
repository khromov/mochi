import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Mochi } from './Mochi';
import { closeAllQueueResources, getBoss, mountQueues, startQueueRuntime } from './queue';
import type { MochiJob } from './queue';
import { mochiEvents } from './events';
import { initExtensions } from './extensions';
import { resetStartupMilestones } from './lifecycle';
import { logger } from './utils/log';

const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-queue-worker-'));

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
  initExtensions({});
  await closeAllQueueResources();
});

afterAll(async () => {
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
});

describe('Mochi.worker()', () => {
  test('consumes a backlog enqueued by a standalone producer, then stop() halts consumption', async () => {
    const file = path.join(dataDir, 'worker.sqlite');
    const processed: number[] = [];
    const twoDone = deferred<void>();
    const queue = Mochi.queue<{ n: number }>('worker-jobs', {
      storage: { sqlite: file },
      pollingIntervalSeconds: 0.5,
      process: async (job: MochiJob<{ n: number }>) => {
        processed.push(job.data.n);
        if (processed.length === 2) {
          twoDone.resolve();
        }
      },
    });

    // Producer-only enqueue first: nothing consumes yet.
    await queue.addBulk([{ data: { n: 1 } }, { data: { n: 2 } }]);

    const worker = Mochi.worker({ queues: [queue] });
    await worker.start();
    await twoDone.promise;
    expect(processed.toSorted()).toEqual([1, 2]);

    await worker.stop();
    const heldId = await queue.add({ n: 3 });
    await Bun.sleep(1200);
    expect(processed).toHaveLength(2);
    expect((await getBoss().getJobById('worker-jobs', heldId!))?.state).toBe('created');

    // Per-queue stop from a worker process: releases the last active queue, so the runtime closes with it.
    await queue.stop();
    expect(() => getBoss()).toThrow(/queue runtime is not running/);
  }, 20_000);

  test('resolves storage from the worker option and rejects contradictions', async () => {
    expect(() => Mochi.worker({ queues: [] })).toThrow(/at least one queue/);
    expect(() => Mochi.worker({ queues: [Mochi.queue('a'), Mochi.queue('a')] })).toThrow(/two queues are named "a"/);
    expect(() =>
      Mochi.worker({
        queues: [Mochi.queue('a', { storage: 'memory' }), Mochi.queue('b', { storage: { sqlite: path.join(dataDir, 'b.sqlite') } })],
      }),
    ).toThrow(/declare different storages/);
    expect(() => Mochi.worker({ queues: [Mochi.queue('a', { storage: 'memory' })], storage: { sqlite: path.join(dataDir, 'c.sqlite') } })).toThrow(/declares a different storage/);

    const worker = Mochi.worker({ queues: [Mochi.queue('storage-less')] });
    expect(worker.start()).rejects.toThrow(/no storage declared/);
  });

  test('never re-syncs stored queue options and refuses a second start', async () => {
    const file = path.join(dataDir, 'worker-noresync.sqlite');
    // A serve-style deployment mounts the queue with its own settings first.
    await startQueueRuntime({ sqlite: file });
    await mountQueues([{ name: 'owned-jobs', options: { expireInSeconds: 42, retryLimit: 7 } }]);
    await closeAllQueueResources();

    const done = deferred<void>();
    const worker = Mochi.worker({
      queues: [
        Mochi.queue('owned-jobs', {
          pollingIntervalSeconds: 0.5,
          expireInSeconds: 900,
          retryLimit: 1,
          process: async () => done.resolve(),
        }),
      ],
      storage: { sqlite: file },
    });
    await worker.start();
    expect(worker.start()).rejects.toThrow(/already started/);

    await Mochi.getQueue<Record<string, never>>('owned-jobs').add({});
    await done.promise;
    const stored = await getBoss().getQueue('owned-jobs');
    expect(stored?.expireInSeconds).toBe(42);
    expect(stored?.retryLimit).toBe(7);
  }, 20_000);

  test('refuses to start in a serving process', async () => {
    await startQueueRuntime('memory');
    const worker = Mochi.worker({ queues: [Mochi.queue('served', { storage: 'memory' })] });
    expect(worker.start()).rejects.toThrow(/this process is serving/);
  });

  test('applies an in-array deadLetter on first creation, so a terminally failed job lands in the DLQ', async () => {
    const file = path.join(dataDir, 'worker-dlq.sqlite');
    const landed = deferred<MochiJob<{ payload: string }>>();
    const work = Mochi.queue<{ payload: string }>('work', {
      storage: { sqlite: file },
      pollingIntervalSeconds: 0.5,
      retryLimit: 0,
      deadLetter: 'work-dlq',
      process: async () => {
        throw new Error('unprocessable');
      },
    });
    // The dead-letter queue is declared after the queue that references it, proving order doesn't matter.
    const dlq = Mochi.queue<{ payload: string }>('work-dlq', {
      storage: { sqlite: file },
      pollingIntervalSeconds: 0.5,
      process: async (job: MochiJob<{ payload: string }>) => landed.resolve(job),
    });

    await Mochi.worker({ queues: [work, dlq] }).start();
    expect((await getBoss().getQueue('work'))?.deadLetter).toBe('work-dlq');

    await work.add({ payload: 'keep-me' });
    const job = await landed.promise;
    expect(job.queue).toBe('work-dlq');
    expect(job.data).toEqual({ payload: 'keep-me' });
  }, 20_000);

  test('skips a deadLetter that names a queue outside the worker array, with a warning, and still mounts', async () => {
    const file = path.join(dataDir, 'worker-dlq-outside.sqlite');
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const worker = Mochi.worker({
        queues: [Mochi.queue('lonely', { storage: { sqlite: file }, pollingIntervalSeconds: 0.5, deadLetter: 'elsewhere', process: async () => {} })],
      });
      await worker.start();
      expect((await getBoss().getQueue('lonely'))?.deadLetter).toBeNull();
      expect(warn.mock.calls.some((args) => String(args[0]).includes('names "elsewhere" as its deadLetter'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  }, 20_000);

  test('rejects a queue that names itself as its deadLetter', async () => {
    const file = path.join(dataDir, 'worker-dlq-self.sqlite');
    const worker = Mochi.worker({ queues: [Mochi.queue('selfref', { storage: { sqlite: file }, pollingIntervalSeconds: 0.5, deadLetter: 'selfref', process: async () => {} })] });
    expect(worker.start()).rejects.toThrow(/names itself as its deadLetter/);
  });
});
