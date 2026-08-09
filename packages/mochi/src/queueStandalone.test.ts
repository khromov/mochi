import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Mochi } from './Mochi';
import { closeAllQueueResources, getBoss, getQueue, mountQueues, startQueueRuntime } from './queue';
import { mochiEvents } from './events';
import { initExtensions } from './extensions';
import { resetStartupMilestones, startupMilestoneReached } from './lifecycle';

const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-queue-standalone-'));

let counter = 0;
const uniqueName = (): string => `standalone-${counter++}`;

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

describe('standalone queue producers', () => {
  test('a descriptor without storage cannot produce outside serve', async () => {
    const q = Mochi.queue<{ n: number }>(uniqueName());
    expect(q.add({ n: 1 })).rejects.toThrow(/has no storage and no Mochi\.serve/);
  });

  test('the first add lazily connects a producer-only runtime', async () => {
    const name = uniqueName();
    const file = path.join(dataDir, 'lazy.sqlite');
    const q = Mochi.queue<{ n: number }>(name, { storage: { sqlite: file } });
    const added: unknown[] = [];
    mochiEvents.on('queue:added', (e) => added.push(e));

    const jobId = await q.add({ n: 1 });
    expect(jobId).toBeString();
    expect(added).toEqual([{ queue: name, jobId }]);

    // Producer-only: the runtime is up, but no worker was registered, so the job just sits there.
    expect(getBoss().getWipData()).toHaveLength(0);
    const job = await getBoss().getJobById(name, jobId!);
    expect(job?.state).toBe('created');

    // The name-based lookup resolves the lazily-connected handle, and the serve milestone was never marked.
    expect(getQueue(name).name).toBe(name);
    expect(startupMilestoneReached('mochi:queuesMounted')).toBe(false);
  });

  test('concurrent first adds share one runtime boot', async () => {
    const name = uniqueName();
    const q = Mochi.queue<{ n: number }>(name, { storage: { sqlite: path.join(dataDir, 'race.sqlite') } });

    const ids = await Promise.all([q.add({ n: 1 }), q.add({ n: 2 }), q.addBulk([{ data: { n: 3 } }])]);
    expect(ids[0]).toBeString();
    expect(ids[1]).toBeString();
    expect(ids[2]).toHaveLength(1);
    expect(typeof getBoss().send).toBe('function');
  });

  test('a second descriptor with different storage is rejected', async () => {
    const first = Mochi.queue<{ n: number }>(uniqueName(), { storage: { sqlite: path.join(dataDir, 'first.sqlite') } });
    await first.add({ n: 1 });

    const other = Mochi.queue<{ n: number }>(uniqueName(), { storage: { sqlite: path.join(dataDir, 'other.sqlite') } });
    expect(other.add({ n: 1 })).rejects.toThrow(/already connected to .* One queue runtime per process/);

    // Same storage is fine — the runtime is shared.
    const sibling = Mochi.queue<{ n: number }>(uniqueName(), { storage: { sqlite: path.join(dataDir, 'first.sqlite') } });
    expect(await sibling.add({ n: 2 })).toBeString();
  });

  test('a standalone producer never re-syncs consumer-owned queue options', async () => {
    const name = uniqueName();
    const file = path.join(dataDir, 'noresync.sqlite');
    // A consumer deployment mounts the queue with its own expiry/retry settings...
    await startQueueRuntime({ sqlite: file });
    await mountQueues([{ name, options: { expireInSeconds: 42, retryLimit: 7 } }]);
    expect((await getBoss().getQueue(name))?.expireInSeconds).toBe(42);
    await closeAllQueueResources();

    // ...then a bare producer (different options in code) enqueues: the stored options must survive untouched.
    const producer = Mochi.queue<{ n: number }>(name, { storage: { sqlite: file }, expireInSeconds: 900, retryLimit: 1 });
    await producer.add({ n: 1 });
    const stored = await getBoss().getQueue(name);
    expect(stored?.expireInSeconds).toBe(42);
    expect(stored?.retryLimit).toBe(7);
  }, 15_000);

  test('queue.stop() releases the queue and closes the runtime when it was the last one', async () => {
    const file = path.join(dataDir, 'per-queue-stop.sqlite');
    const first = Mochi.queue<{ n: number }>(uniqueName(), { storage: { sqlite: file } });
    const second = Mochi.queue<{ n: number }>(uniqueName(), { storage: { sqlite: file } });
    await first.add({ n: 1 });
    await second.add({ n: 1 });

    // Two queues share the runtime: stopping one leaves it up for the other.
    await first.stop();
    expect(typeof getBoss().send).toBe('function');
    expect(() => getQueue(first.name)).toThrow();
    expect(await second.add({ n: 2 })).toBeString();

    await second.stop();
    expect(() => getBoss()).toThrow(/queue runtime is not running/);

    // Idempotent, and a later add lazily reconnects.
    await expect(second.stop()).resolves.toBeUndefined();
    expect(await first.add({ n: 3 })).toBeString();
    await first.stop();
  }, 15_000);

  test('queue.stop() refuses in a serving process', async () => {
    await startQueueRuntime('memory');
    const q = Mochi.queue<{ n: number }>(uniqueName(), { storage: 'memory' });
    expect(q.stop()).rejects.toThrow(/this process is serving/);
  });

  test('Mochi.stop() tears down a standalone runtime without a server and is idempotent', async () => {
    const name = uniqueName();
    const q = Mochi.queue<{ n: number }>(name, { storage: { sqlite: path.join(dataDir, 'stop.sqlite') } });
    await q.add({ n: 1 });
    expect(typeof getBoss().send).toBe('function');

    await Mochi.stop();
    expect(() => getBoss()).toThrow(/queue runtime is not running/);
    await expect(Mochi.stop()).resolves.toBeUndefined();

    // A later add reconnects lazily — the registry was fully reset.
    expect(await q.add({ n: 2 })).toBeString();
    await Mochi.stop();
  }, 15_000);
});
