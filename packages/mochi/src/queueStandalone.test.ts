import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rmWithRetry } from './__fixtures__/rmWithRetry';
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

afterAll(() => rmWithRetry(dataDir));

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

  test('a same-name descriptor with different storage is rejected even after the name is connected', async () => {
    const name = uniqueName();
    const q1 = Mochi.queue<{ n: number }>(name, { storage: { sqlite: path.join(dataDir, 'fast.sqlite') } });
    await q1.add({ n: 1 });

    // The fast path for an already-registered name must still catch the mismatch — the silent alternative writes
    // this descriptor's jobs into q1's store.
    const q2 = Mochi.queue<{ n: number }>(name, { storage: { sqlite: path.join(dataDir, 'fast-other.sqlite') } });
    await expect(q2.add({ n: 2 })).rejects.toThrow(/already connected to .* One queue runtime per process/);
    await expect(q2.addBulk([{ data: { n: 3 } }])).rejects.toThrow(/already connected to/);
  });

  test('Mochi.stop() racing an in-flight lazy connect tears the runtime down, not past it', async () => {
    const q = Mochi.queue<{ n: number }>(uniqueName(), { storage: { sqlite: path.join(dataDir, 'stop-race.sqlite') } });
    const addP = q.add({ n: 1 });
    await Mochi.stop();
    await addP.catch(() => {});
    // Without waiting for the connect, the boot would register a live runtime (timers, open handles) after stop resolved.
    expect(() => getBoss()).toThrow(/queue runtime is not running/);
  });

  test('a serve boot racing an in-flight lazy connect adopts the runtime instead of double-booting', async () => {
    const name = uniqueName();
    const file = path.join(dataDir, 'adopt-race.sqlite');
    const q = Mochi.queue<{ n: number }>(name, { storage: { sqlite: file } });
    const addP = q.add({ n: 1 });
    await startQueueRuntime({ sqlite: file }, { kind: 'serve' });
    await addP.catch(() => {});

    // Adopted: one serve-owned runtime, so an unmounted queue cannot produce until mountQueues declares it.
    await expect(q.add({ n: 2 })).rejects.toThrow(/still booting|not in this process/);
    await mountQueues([{ name }]);
    expect(await q.add({ n: 3 })).toBeString();
  });

  test('a bare producer is an existence reference: stored options survive, while a differing declaration is rejected', async () => {
    const name = uniqueName();
    const file = path.join(dataDir, 'authority.sqlite');
    // A consumer deployment mounts the queue with its own expiry/retry settings...
    await startQueueRuntime({ sqlite: file });
    await mountQueues([{ name, options: { expireInSeconds: 42, retryLimit: 7 } }]);
    expect((await getBoss().getQueue(name))?.expireInSeconds).toBe(42);
    await closeAllQueueResources();

    // ...then a bare producer (no persisted options declared) enqueues: it asserts existence, not config.
    const bare = Mochi.queue<{ n: number }>(name, { storage: { sqlite: file } });
    await bare.add({ n: 1 });
    const stored = await getBoss().getQueue(name);
    expect(stored?.expireInSeconds).toBe(42);
    expect(stored?.retryLimit).toBe(7);
    await closeAllQueueResources();

    // A producer that does declare options is held to them: code is authoritative, and this code disagrees with storage.
    const differing = Mochi.queue<{ n: number }>(name, { storage: { sqlite: file }, expireInSeconds: 900, retryLimit: 1 });
    await expect(differing.add({ n: 2 })).rejects.toThrow(/already exists in storage with retryLimit 7, expireInSeconds 42.*declares retryLimit 1, expireInSeconds 900/);
  }, 15_000);

  test('a producer-first enqueue creates the queue with its descriptor-form deadLetter link intact', async () => {
    const file = path.join(dataDir, 'producer-dlq.sqlite');
    const dlq = Mochi.queue<{ n: number }>('producer-work-dlq', { storage: { sqlite: file } });
    const work = Mochi.queue<{ n: number }>('producer-work', { storage: { sqlite: file }, retryLimit: 0, deadLetter: dlq });

    // The issue's repro: on fresh storage the producer runs first — the link must exist without any migration.
    expect(await work.add({ n: 1 })).toBeString();
    expect((await getBoss().getQueue('producer-work'))?.deadLetter).toBe('producer-work-dlq');
    // The target was ensured, but only the queue actually added to is registered as a producer handle.
    expect(await getBoss().getQueue('producer-work-dlq')).not.toBeNull();
    expect(() => getQueue('producer-work-dlq')).toThrow();
  }, 15_000);

  test('a producer with a string deadLetter whose target does not exist is rejected with the descriptor remedy', async () => {
    const file = path.join(dataDir, 'producer-dlq-missing.sqlite');
    const work = Mochi.queue<{ n: number }>('orphan-work', { storage: { sqlite: file }, deadLetter: 'orphan-dlq' });
    await expect(work.add({ n: 1 })).rejects.toThrow(/"orphan-dlq" is not declared here and does not exist in storage.*Pass the target's descriptor/);
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
