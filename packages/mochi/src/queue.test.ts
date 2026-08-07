import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startQueueRuntime, mountQueues, getQueue, getBoss, closeAllQueueResources, DEFAULT_EXPIRE_IN_SECONDS } from './queue';
import type { MochiJob, MochiQueueStorage } from './queue';
import { mochiEvents } from './events';
import { initExtensions } from './extensions';
import { markStartupMilestone, resetStartupMilestones } from './lifecycle';

const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-queue-test-'));

let counter = 0;
const uniqueName = (): string => `q-${counter++}`;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface TestQueueConfig {
  process?: (job: MochiJob<never>) => unknown;
  options?: Record<string, unknown>;
  on?: Record<string, unknown>;
}

// Mirrors what Mochi.serve does for a non-empty queues map, with spies on for deterministic waits.
async function startWith(queues: Record<string, TestQueueConfig>, storage: MochiQueueStorage = 'memory'): Promise<void> {
  await startQueueRuntime(storage, { enableSpies: true });
  await mountQueues(Object.entries(queues) as Parameters<typeof mountQueues>[0]);
}

afterEach(async () => {
  mochiEvents.all.clear();
  resetStartupMilestones();
  initExtensions({});
  await closeAllQueueResources();
});

afterAll(async () => {
  // Windows releases SQLite file locks asynchronously, so an immediate rm can throw EBUSY. (Bun ignores rmSync's
  // maxRetries option, so retry by hand.) Best-effort cleanup of an ephemeral temp dir — never fail the suite over it.
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
});

describe('Mochi queue', () => {
  test('roundtrips a job from producer to consumer', async () => {
    const name = uniqueName();
    const seen = deferred<MochiJob<{ to: string }>>();

    await startWith({
      [name]: {
        process: async (job: MochiJob<{ to: string }>) => {
          seen.resolve(job);
          return { sent: true };
        },
      },
    });

    // Attached before the add: the spy only records transitions that happen after it exists.
    const spy = getBoss().getSpy(name);
    const jobId = await getQueue<{ to: string }>(name).add({ to: 'alice@example.com' });
    expect(jobId).toBeString();

    const job = await seen.promise;
    expect(job.data).toEqual({ to: 'alice@example.com' });
    expect(job.queue).toBe(name);
    expect(job.attempt).toBe(1);
    expect(job.id).toBe(jobId!);
    expect(job.enqueuedAt).toBeGreaterThan(Date.now() - 60_000);

    await spy.waitForJobWithId(jobId!, 'completed');
  });

  test('addBulk enqueues every job and returns their ids', async () => {
    const name = uniqueName();
    let processed = 0;
    const done = deferred<void>();

    await startWith({
      [name]: {
        process: async () => {
          if (++processed === 3) {
            done.resolve();
          }
        },
      },
    });

    const ids = await getQueue<{ n: number }>(name).addBulk([{ data: { n: 1 } }, { data: { n: 2 } }, { data: { n: 3 } }]);
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      expect(id).toBeString();
    }
    await done.promise;
    expect(processed).toBe(3);
  });

  test('runs up to `concurrency` jobs of one queue in parallel', async () => {
    const name = uniqueName();
    let active = 0;
    let maxActive = 0;
    let completed = 0;
    const allDone = deferred<void>();

    await startWith({
      [name]: {
        process: async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          // Long enough that the second worker's next poll (0.5s) lands while the first job is still running.
          await Bun.sleep(700);
          active--;
          if (++completed === 4) {
            allDone.resolve();
          }
        },
        options: { concurrency: 2, pollingIntervalSeconds: 0.5 },
      },
    });

    await getQueue<{ i: number }>(name).addBulk([0, 1, 2, 3].map((i) => ({ data: { i } })));

    await allDone.promise;
    // The ceiling must hold and be reached, but a loaded CI runner may stall past the 700ms overlap window, so the
    // exact interleaving beyond that is not asserted.
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(1);
  }, 15_000);

  test('emits queue:* lifecycle events on the mochi bus', async () => {
    const name = uniqueName();
    const added: unknown[] = [];
    const active: unknown[] = [];
    const completed = deferred<{ queue: string; jobId: string; attempt: number; duration: number }>();

    mochiEvents.on('queue:added', (e) => added.push(e));
    mochiEvents.on('queue:active', (e) => active.push(e));
    mochiEvents.on('queue:completed', (e) => completed.resolve(e));

    await startWith({ [name]: { process: async () => ({ ok: true }) } });
    const jobId = await getQueue<{ x: number }>(name).add({ x: 1 });

    const done = await completed.promise;
    expect(added).toEqual([{ queue: name, jobId }]);
    expect(active).toEqual([{ queue: name, jobId, attempt: 1 }]);
    expect(done.queue).toBe(name);
    expect(done.jobId).toBe(jobId!);
    expect(done.attempt).toBe(1);
    expect(done.duration).toBeGreaterThanOrEqual(0);
  });

  test('a failing job retries and reports every attempt via queue:failed and on.failed', async () => {
    const name = uniqueName();
    const eventAttempts: number[] = [];
    const listenerAttempts: number[] = [];

    mochiEvents.on('queue:failed', (e) => eventAttempts.push(e.attempt));

    await startWith({
      [name]: {
        process: async () => {
          throw new Error('boom');
        },
        options: { retryLimit: 1, retryDelay: 0, pollingIntervalSeconds: 0.5 },
        on: {
          failed: (job: MochiJob<never>) => {
            listenerAttempts.push(job.attempt);
          },
        },
      },
    });

    const spy = getBoss().getSpy(name);
    const jobId = await getQueue(name).add({ y: 1 } as never);
    // The spy's `failed` state fires only on the terminal failure, so intermediate attempts are observed off the bus.
    await spy.waitForJobWithId(jobId!, 'failed');

    expect(eventAttempts).toEqual([1, 2]);
    expect(listenerAttempts).toEqual([1, 2]);
  }, 15_000);

  test('a throwing completed listener does not fail or retry the job', async () => {
    const name = uniqueName();
    let runs = 0;
    const failedEvents: unknown[] = [];
    mochiEvents.on('queue:failed', (e) => failedEvents.push(e));

    await startWith({
      [name]: {
        process: async () => {
          runs++;
          return { ok: true };
        },
        on: {
          completed: () => {
            throw new Error('listener boom');
          },
        },
      },
    });

    const spy = getBoss().getSpy(name);
    const jobId = await getQueue(name).add({ n: 1 } as never);
    // Only `process` decides the outcome: the store must record `completed` even though the listener threw.
    await spy.waitForJobWithId(jobId!, 'completed');
    expect(runs).toBe(1);
    expect(failedEvents).toEqual([]);
  });

  test('a terminally failed job moves to its deadLetter queue, whatever the declaration order', async () => {
    const work = uniqueName();
    const dlq = uniqueName();
    const landed = deferred<MochiJob<{ payload: string }>>();

    // The failing queue is declared before the dead-letter queue it references, proving mount order doesn't matter.
    await startWith({
      [work]: {
        process: async () => {
          throw new Error('unprocessable');
        },
        options: { retryLimit: 0, pollingIntervalSeconds: 0.5, deadLetter: dlq },
      },
      [dlq]: {
        process: async (job: MochiJob<{ payload: string }>) => {
          landed.resolve(job);
        },
        options: { pollingIntervalSeconds: 0.5 },
      },
    });

    await getQueue<{ payload: string }>(work).add({ payload: 'keep-me' });

    const job = await landed.promise;
    expect(job.queue).toBe(dlq);
    expect(job.data).toEqual({ payload: 'keep-me' });
  }, 15_000);

  test('a queue without a processor mounts and accepts jobs', async () => {
    const name = uniqueName();
    await startWith({ [name]: {} });

    // The spy only records transitions for queues it was attached to before they happened.
    const spy = getBoss().getSpy(name);
    const jobId = await getQueue(name).add({ held: true } as never);
    expect(jobId).toBeString();
    const held = await spy.waitForJobWithId(jobId!, 'created');
    expect(held.state).toBe('created');
  });

  test('a duplicate explicit id resolves null and emits no queue:added', async () => {
    const name = uniqueName();
    const added: unknown[] = [];
    mochiEvents.on('queue:added', (e) => added.push(e));

    await startWith({ [name]: {} });
    const queue = getQueue<{ n: number }>(name);

    const first = await queue.add({ n: 1 }, { id: crypto.randomUUID() });
    expect(first).toBeString();
    const dupe = await queue.add({ n: 2 }, { id: first! });
    expect(dupe).toBeNull();
    expect(added).toHaveLength(1);
  });

  test('addThrottled suppresses adds within the slot; addDebounced books the next slot first', async () => {
    const name = uniqueName();
    await startWith({ [name]: {} });
    const queue = getQueue<{ n: number }>(name);

    const first = await queue.addThrottled({ n: 1 }, 60, 'throttle-key');
    expect(first).toBeString();
    expect(await queue.addThrottled({ n: 2 }, 60, 'throttle-key')).toBeNull();

    // Debounce: the first add takes the current slot, the second books the next slot, the third has nowhere to go.
    const d1 = await queue.addDebounced({ n: 1 }, 60, 'debounce-key');
    expect(d1).toBeString();
    await queue.addDebounced({ n: 2 }, 60, 'debounce-key');
    expect(await queue.addDebounced({ n: 3 }, 60, 'debounce-key')).toBeNull();
  });

  test('queue:expireInSeconds is resolved once per queue, after the per-queue option', async () => {
    const seen: Array<{ value: number; queue: string; explicit: boolean }> = [];
    initExtensions({ filters: { 'queue:expireInSeconds': (value, ctx) => (seen.push({ value, ...ctx }), value) } });

    const defaulted = uniqueName();
    const chosen = uniqueName();
    await startWith({
      [defaulted]: {},
      [chosen]: { options: { expireInSeconds: 42 } },
    });

    expect(seen).toEqual([
      { value: DEFAULT_EXPIRE_IN_SECONDS, queue: defaulted, explicit: false },
      { value: 42, queue: chosen, explicit: true },
    ]);
    const queue = await getBoss().getQueue(chosen);
    expect(queue?.expireInSeconds).toBe(42);
  });

  test('does not leak bun-boss job fields into the processor', async () => {
    const name = uniqueName();
    const seen = deferred<MochiJob<unknown>>();

    await startWith({
      [name]: {
        process: async (job: MochiJob<unknown>) => {
          seen.resolve(job);
          return null;
        },
      },
    });

    await getQueue(name).add({ hello: 'world' } as never);

    const job = await seen.promise;
    expect((job as unknown as Record<string, unknown>).signal).toBeUndefined();
    expect((job as unknown as Record<string, unknown>).expireInSeconds).toBeUndefined();
    expect(Object.keys(job).sort()).toEqual(['attempt', 'data', 'enqueuedAt', 'id', 'queue']);
  });

  test('getQueue resolves the producer handle mounted for a name', async () => {
    const name = uniqueName();
    await startWith({ [name]: {} });
    expect(getQueue(name).name).toBe(name);
  });

  // The mount milestone is what separates "too early" from "wrong name" — see getQueue in ./queue.ts. These tests never
  // run Mochi.serve(), so the milestone is unset and every lookup is legitimately "too early".
  test('getQueue blames the lifecycle, not a typo, before queues are mounted', () => {
    expect(() => getQueue('never-declared')).toThrow(/queues are not mounted yet/);
    expect(() => getQueue('never-declared')).toThrow(/mochi:init/);
  });

  test('getQueue names the mounted queues once mounting finished', async () => {
    const name = uniqueName();
    await startWith({ [name]: {} });
    markStartupMilestone('mochi:queuesMounted');
    expect(() => getQueue('typoed')).toThrow(/no such queue/);
    expect(() => getQueue('typoed')).toThrow(new RegExp(`Mounted queues: ${name}`));
  });

  test('getQueue says so when serve mounted no queues at all', () => {
    markStartupMilestone('mochi:queuesMounted');
    expect(() => getQueue('emails')).toThrow(/no queues were declared/);
  });

  test('getBoss throws before the runtime starts and resolves the instance after', async () => {
    expect(() => getBoss()).toThrow(/queue runtime is not running/);
    await startWith({});
    expect(typeof getBoss().send).toBe('function');
  });

  test('a failed start tears the partial runtime down and leaves it restartable', async () => {
    const file = path.join(dataDir, 'corrupt.sqlite');
    writeFileSync(file, 'not a sqlite database');

    await expect(startQueueRuntime({ sqlite: file })).rejects.toThrow();
    // The failure path must stop the partially-started boss and release the SQL handle itself — the boss never
    // reached the registry, so closeAllQueueResources() alone could not have.
    expect(() => getBoss()).toThrow(/queue runtime is not running/);
    await startWith({});
    expect(typeof getBoss().send).toBe('function');
  });

  test('jobs in sqlite storage survive a runtime restart', async () => {
    const name = uniqueName();
    const file = path.join(dataDir, 'restart.sqlite');
    // First boot enqueues without a worker, like a process that dies before processing.
    await startWith({ [name]: {} }, { sqlite: file });
    await getQueue<{ n: number }>(name).add({ n: 7 });
    await closeAllQueueResources();
    expect(existsSync(file)).toBe(true);

    const seen = deferred<MochiJob<{ n: number }>>();
    await startWith(
      {
        [name]: {
          process: async (job: MochiJob<{ n: number }>) => {
            seen.resolve(job);
          },
          options: { pollingIntervalSeconds: 0.5 },
        },
      },
      { sqlite: file },
    );

    const job = await seen.promise;
    expect(job.data).toEqual({ n: 7 });
  }, 15_000);

  test('closeAllQueueResources closes everything and is idempotent', async () => {
    const name = uniqueName();
    await startWith({ [name]: {} });

    await closeAllQueueResources();
    expect(() => getQueue(name)).toThrow(/queues are not mounted yet/);
    // A second call must not throw even though the registry is already empty.
    await expect(closeAllQueueResources()).resolves.toBeUndefined();
  });
});
