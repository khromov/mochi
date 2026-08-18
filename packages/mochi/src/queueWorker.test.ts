import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rmWithRetry } from './__fixtures__/rmWithRetry';
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

afterAll(() => rmWithRetry(dataDir));

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

  test('rejects declared options that differ from storage, and queueConfig sync repairs them', async () => {
    const file = path.join(dataDir, 'worker-authority.sqlite');
    // A prior deployment mounted the queue with different settings.
    await startQueueRuntime({ sqlite: file });
    await mountQueues([{ name: 'owned-jobs', options: { expireInSeconds: 42, retryLimit: 7 } }]);
    await closeAllQueueResources();

    const done = deferred<void>();
    const queues = () => [
      Mochi.queue('owned-jobs', {
        storage: { sqlite: file },
        pollingIntervalSeconds: 0.5,
        expireInSeconds: 900,
        retryLimit: 1,
        process: async () => done.resolve(),
      }),
    ];
    await expect(Mochi.worker({ queues: queues() }).start()).rejects.toThrow(
      /"owned-jobs" already exists in storage with retryLimit 7, expireInSeconds 42, but this code declares retryLimit 1, expireInSeconds 900/,
    );

    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const worker = Mochi.worker({ queues: queues(), queueConfig: 'sync' });
      await worker.start();
      expect(worker.start()).rejects.toThrow(/already started/);
      const stored = await getBoss().getQueue('owned-jobs');
      expect(stored?.expireInSeconds).toBe(900);
      expect(stored?.retryLimit).toBe(1);
      expect(warn.mock.calls.some((args) => String(args[0]).includes('synced stored config to the declaration'))).toBe(true);
    } finally {
      warn.mockRestore();
    }

    await Mochi.getQueue<Record<string, never>>('owned-jobs').add({});
    await done.promise;
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

  test('rejects a string deadLetter whose target is neither declared nor in storage, and accepts one that already exists', async () => {
    const file = path.join(dataDir, 'worker-dlq-outside.sqlite');
    const declare = () => Mochi.queue('lonely', { storage: { sqlite: file }, pollingIntervalSeconds: 0.5, deadLetter: 'elsewhere', process: async () => {} });
    await expect(Mochi.worker({ queues: [declare()] }).start()).rejects.toThrow(/"elsewhere" is not declared here and does not exist in storage.*Pass the target's descriptor/);

    // Once the target exists in storage, the same string-form declaration creates the queue with its link.
    await getBoss().createQueue('elsewhere');
    await Mochi.worker({ queues: [declare()] }).start();
    expect((await getBoss().getQueue('lonely'))?.deadLetter).toBe('elsewhere');
  }, 20_000);

  test('ensures a descriptor-form deadLetter target outside the queues array automatically', async () => {
    const file = path.join(dataDir, 'worker-dlq-descriptor.sqlite');
    const dlq = Mochi.queue('desc-dlq', { storage: { sqlite: file } });
    const worker = Mochi.worker({
      queues: [Mochi.queue('desc-work', { storage: { sqlite: file }, pollingIntervalSeconds: 0.5, deadLetter: dlq, process: async () => {} })],
    });
    await worker.start();
    expect((await getBoss().getQueue('desc-work'))?.deadLetter).toBe('desc-dlq');
    expect(await getBoss().getQueue('desc-dlq')).not.toBeNull();
  }, 20_000);

  test('rejects a queue that names itself as its deadLetter', async () => {
    const file = path.join(dataDir, 'worker-dlq-self.sqlite');
    const worker = Mochi.worker({ queues: [Mochi.queue('selfref', { storage: { sqlite: file }, pollingIntervalSeconds: 0.5, deadLetter: 'selfref', process: async () => {} })] });
    expect(worker.start()).rejects.toThrow(/names itself as its deadLetter/);
  });

  test('rejects a pre-existing queue missing its declared deadLetter link, and sync repoints it', async () => {
    const file = path.join(dataDir, 'worker-dlq-preexisting.sqlite');
    // A prior deploy created the queue without a deadLetter link.
    await startQueueRuntime({ sqlite: file });
    await mountQueues([{ name: 'pre' }, { name: 'pre-dlq' }]);
    await closeAllQueueResources();

    const queues = () => [
      Mochi.queue('pre', { storage: { sqlite: file }, pollingIntervalSeconds: 0.5, deadLetter: 'pre-dlq', process: async () => {} }),
      Mochi.queue('pre-dlq', { storage: { sqlite: file }, pollingIntervalSeconds: 0.5, process: async () => {} }),
    ];
    await expect(Mochi.worker({ queues: queues() }).start()).rejects.toThrow(
      /"pre" already exists in storage with deadLetter unset, but this code declares deadLetter "pre-dlq".*MOCHI_QUEUE_SYNC=1/,
    );

    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await Mochi.worker({ queues: queues(), queueConfig: 'sync' }).start();
      expect((await getBoss().getQueue('pre'))?.deadLetter).toBe('pre-dlq');
      expect(warn.mock.calls.some((args) => String(args[0]).includes('deadLetter unset → "pre-dlq"'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  }, 20_000);
});
