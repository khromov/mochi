import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createQueue, getQueue, closeAllQueueResources, runQueueRecovery } from './queue';
import type { MochiJob, MochiQueueRuntimeOptions } from './queue';
import { mochiEvents } from './events';
import { initExtensions } from './extensions';
import { setLogLevel } from './utils/log';
import { markStartupMilestone, resetStartupMilestones } from './lifecycle';
import { SQL } from 'bun';
import { startTestPostgres, type TestPostgres } from './__fixtures__/postgres/startTestPostgres';

const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-queue-test-'));

let counter = 0;
const uniqueName = (): string => `q-${counter++}`;

// The behavioural core runs once per backend: the default in-memory store, the bun:sqlite store, and the Bun.sql
// Postgres store (against an in-process PGlite server speaking the real wire protocol) — all three must be
// indistinguishable to a processor.
// Booted with top-level await: PGlite's WASM instantiation can exceed bun's 5s hook timeout, and module load has none.
const pg: TestPostgres = await startTestPostgres();
// One shared prepare-less pool for every postgres store: pglite-socket multiplexes all connections onto a single
// immortal PGlite session, where the named prepared statements of successive pools collide (42P05).
const pgSql = new SQL({ url: pg.url, prepare: false });
const backends: Array<{ label: string; options: () => MochiQueueRuntimeOptions<never> }> = [
  { label: 'memory', options: () => ({}) },
  { label: 'sqlite', options: () => ({ store: { type: 'sqlite', path: path.join(dataDir, `store-${counter++}.sqlite`) } }) },
  { label: 'postgres', options: () => ({ store: { type: 'postgres', sql: pgSql } }) },
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
  await pgSql.close();
  await pg.close();
  // Windows releases SQLite file locks asynchronously, so an immediate rm can throw EBUSY. (Bun ignores rmSync's
  // maxRetries option, so retry by hand.) This is best-effort cleanup of an ephemeral temp dir — never fail the suite
  // over it, so give up quietly once the budget is exhausted; the OS reclaims it on process exit regardless.
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
});

for (const backend of backends) {
  describe(`Mochi queue (${backend.label})`, () => {
    const options = <T>(extra?: MochiQueueRuntimeOptions<T>): MochiQueueRuntimeOptions<T> => ({ ...(backend.options() as MochiQueueRuntimeOptions<T>), ...extra });

    test('roundtrips a job from producer to processor', async () => {
      const name = uniqueName();
      const seen = deferred<MochiJob<{ to: string }>>();

      const queue = createQueue<{ to: string }>(
        name,
        async (job) => {
          seen.resolve(job);
          return { sent: true };
        },
        options(),
      );

      const before = Date.now();
      const ref = await queue.push({ to: 'alice@example.com' });
      expect(ref.id).toBeString();

      const job = await seen.promise;
      expect(job.data).toEqual({ to: 'alice@example.com' });
      expect(job.queue).toBe(name);
      expect(job.attempt).toBe(1);
      expect(job.id).toBe(ref.id);
      expect(job.enqueuedAt).toBeGreaterThanOrEqual(before);
    });

    test('an explicit push id becomes the job id', async () => {
      const name = uniqueName();
      const seen = deferred<MochiJob<{ n: number }>>();
      const queue = createQueue<{ n: number }>(name, async (job) => void seen.resolve(job), options());

      const ref = await queue.push({ n: 1 }, { id: 'submission-42' });
      expect(ref.id).toBe('submission-42');
      expect((await seen.promise).id).toBe('submission-42');
    });

    test('respects concurrent', async () => {
      const name = uniqueName();
      let active = 0;
      let maxActive = 0;
      let completed = 0;
      const allDone = deferred<void>();

      const queue = createQueue<{ i: number }>(
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
        options({ concurrent: 2 }),
      );

      await Promise.all([0, 1, 2, 3].map((i) => queue.push({ i })));

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
      const completed = deferred<{ queue: string; jobId: string; attempt: number; duration: number }>();

      mochiEvents.on('queue:added', (e) => added.push(e));
      mochiEvents.on('queue:active', (e) => active.push(e));
      mochiEvents.on('queue:completed', (e) => completed.resolve(e));

      const queue = createQueue<{ x: number }>(name, async () => ({ ok: true }), options());
      const ref = await queue.push({ x: 1 });

      const done = await completed.promise;
      expect(added).toHaveLength(1);
      expect(active).toHaveLength(1);
      expect(done.queue).toBe(name);
      expect(done.jobId).toBe(ref.id);
      expect(done.attempt).toBe(1);
      expect(done.duration).toBeGreaterThanOrEqual(0);
    });

    test('retries up to maxRetries without a terminal queue:failed', async () => {
      const name = uniqueName();
      const attempts: number[] = [];
      const succeeded = deferred<MochiJob<{ v: number }>>();
      let failedEvents = 0;
      mochiEvents.on('queue:failed', () => failedEvents++);

      const queue = createQueue<{ v: number }>(
        name,
        async (job) => {
          attempts.push(job.attempt);
          if (job.attempt === 1) {
            throw new Error('flaky');
          }
          succeeded.resolve(job);
          return null;
        },
        options({ maxRetries: 2, retryDelay: 10 }),
      );

      await queue.push({ v: 1 });
      const job = await succeeded.promise;
      expect(job.attempt).toBe(2);
      expect(attempts).toEqual([1, 2]);
      // The first failure was a silent retry, not a terminal failure.
      expect(failedEvents).toBe(0);
    });

    test('reports terminal failures via queue:failed and the on.failed listener', async () => {
      const name = uniqueName();
      const failedEvent = deferred<{ error: string; attempt: number }>();
      const failedListener = deferred<Error>();
      let runs = 0;

      mochiEvents.on('queue:failed', (e) => failedEvent.resolve(e));

      const queue = createQueue<{ y: number }>(
        name,
        async () => {
          runs++;
          throw new Error('boom');
        },
        options({ maxRetries: 2, retryDelay: 5 }),
        { failed: (_job, error) => failedListener.resolve(error) },
      );

      await queue.push({ y: 1 });

      const event = await failedEvent.promise;
      // maxRetries is the total attempt budget, so the terminal failure carries the last attempt number.
      expect(event.error).toBe('boom');
      expect(event.attempt).toBe(2);
      expect(runs).toBe(2);

      const error = await failedListener.promise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('boom');
    });

    test('pause/resume gate processing and getStats counts completions', async () => {
      const name = uniqueName();
      let processed = 0;
      const done = deferred<void>();
      // Settled off the bus, not the processor: stats update after the process callback returns.
      let completions = 0;
      mochiEvents.on('queue:completed', () => {
        if (++completions === 2) {
          done.resolve();
        }
      });

      const queue = createQueue<{ n: number }>(
        name,
        async () => {
          processed++;
        },
        options(),
      );

      queue.pause();
      await queue.push({ n: 1 });
      await queue.push({ n: 2 });
      await Bun.sleep(50);
      expect(processed).toBe(0);

      queue.resume();
      await done.promise;
      expect(processed).toBe(2);
      expect(queue.getStats().total).toBe(2);
    });

    test('pushes with the same id merge instead of duplicating', async () => {
      const name = uniqueName();
      const seen: Array<{ v: number }> = [];
      const done = deferred<void>();

      const queue = createQueue<{ v: number }>(
        name,
        async (job) => {
          seen.push(job.data);
          done.resolve();
        },
        options({
          merge: (oldData, newData, cb) => cb(null, { v: oldData.v + newData.v }),
        }),
      );

      queue.pause();
      await queue.push({ v: 1 }, { id: 'same' });
      await queue.push({ v: 2 }, { id: 'same' });
      queue.resume();

      await done.promise;
      await Bun.sleep(30);
      expect(seen).toEqual([{ v: 3 }]);
    });

    test('does not leak queue internals into the processor', async () => {
      const name = uniqueName();
      const seen = deferred<MochiJob<unknown>>();

      const queue = createQueue(
        name,
        async (job) => {
          seen.resolve(job);
          return null;
        },
        options(),
      );

      await queue.push({ hello: 'world' });

      const job = await seen.promise;
      expect(Object.keys(job).sort()).toEqual(['attempt', 'data', 'enqueuedAt', 'id', 'queue']);
    });
  });
}

describe('Mochi queue', () => {
  test('a job outliving maxTimeout fails with task_timeout', async () => {
    const name = uniqueName();
    const failed = deferred<string>();
    mochiEvents.on('queue:failed', (e) => failed.resolve(e.error));

    const queue = createQueue<{ z: number }>(
      name,
      async () => {
        await Bun.sleep(500);
        return { ok: true };
      },
      { maxTimeout: 50 },
    );

    await queue.push({ z: 1 });
    expect(await failed.promise).toBe('task_timeout');
  });

  test('queue:maxTimeoutMs is resolved once per queue, after the per-queue option', () => {
    const seen: Array<{ value: number; queue: string; explicit: boolean }> = [];
    initExtensions({ filters: { 'queue:maxTimeoutMs': (value, ctx) => (seen.push({ value, ...ctx }), value) } });

    const defaulted = uniqueName();
    const chosen = uniqueName();
    const passthrough = uniqueName();
    try {
      createQueue(defaulted, async () => null);
      createQueue(chosen, async () => null, { maxTimeout: 5000 });
      createQueue(passthrough, async () => null, { betterQueue: { maxTimeout: 7000 } });
    } finally {
      initExtensions({});
    }

    expect(seen).toEqual([
      { value: Infinity, queue: defaulted, explicit: false },
      { value: 5000, queue: chosen, explicit: true },
      // The raw escape hatch feeds the filter rather than bypassing it, so the
      // filtered value stays the last word on the timeout.
      { value: 7000, queue: passthrough, explicit: true },
    ]);
  });

  test('getQueue resolves the producer handle created for a name', () => {
    const name = uniqueName();
    const created = createQueue(name, async () => null);
    expect(getQueue(name)).toBe(created);
  });

  // The mount milestone is what separates "too early" from "wrong name" — see
  // getQueue in ./queue.ts. These tests never run Mochi.serve(), so the
  // milestone is unset and every lookup is legitimately "too early".
  test('getQueue blames the lifecycle, not a typo, before queues are mounted', () => {
    expect(() => getQueue('never-declared')).toThrow(/queues are not mounted yet/);
    expect(() => getQueue('never-declared')).toThrow(/mochi:init/);
  });

  test('getQueue names the mounted queues once mounting finished', () => {
    const name = uniqueName();
    createQueue(name, async () => null);
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
    const created = createQueue(name, async () => null);
    let received: unknown;
    await runQueueRecovery([[name, { recover: (queue) => void (received = queue) }]]);
    expect(received).toBe(created);
  });

  test('a throwing recover is contained and reported on the event bus', async () => {
    const name = uniqueName();
    createQueue(name, async () => null);
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
    createQueue(name, async () => null);
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
    createQueue(name, async () => null);

    await closeAllQueueResources();
    // After draining, the handle is gone from the registry.
    expect(() => getQueue(name)).toThrow(/queues are not mounted yet/);
    // A second call must not throw even though the registry is already empty.
    await closeAllQueueResources();
    expect(true).toBe(true);
  });
});
