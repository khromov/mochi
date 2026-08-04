import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { SQL } from 'bun';
import { createQueue, getQueue, closeAllQueueResources, runQueueRecovery, DEFAULT_LOCK_DURATION_MS } from './queue';
import type { MochiJob } from './queue';
import { mochiEvents } from './events';
import { initExtensions } from './extensions';
import { setLogLevel } from './utils/log';
import { markStartupMilestone, resetStartupMilestones } from './lifecycle';

// For tests that need a database surviving closeAllQueueResources (persistence, recovery leases).
const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-queue-test-'));
const fileDatabase = (label: string): string => `sqlite://${path.join(dataDir, `${label}.sqlite`)}`;

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
  resetStartupMilestones();
  await closeAllQueueResources();
});

afterAll(async () => {
  // Windows releases SQLite file locks asynchronously, so an immediate rm can throw EBUSY
  // (and Bun ignores rmSync's maxRetries) — retry by hand, then give up quietly: this is
  // best-effort cleanup of an ephemeral temp dir the OS reclaims on process exit anyway.
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

    const queue = createQueue<{ to: string }>(name, async (job) => {
      seen.resolve(job);
      return { sent: true };
    });

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

    const queue = createQueue<{ n: number }>(name, async () => {
      if (++processed === 3) {
        done.resolve();
      }
    });

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
      { concurrency: 2 },
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

    const queue = createQueue<{ x: number }>(name, async () => ({ ok: true }));
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
    const failedEvent = deferred<{ error: string; attempt: number }>();
    const failedListener = deferred<Error>();

    mochiEvents.on('queue:failed', (e) => failedEvent.resolve(e));

    const queue = createQueue<{ y: number }>(
      name,
      async () => {
        throw new Error('boom');
      },
      undefined,
      { failed: (_job, error) => failedListener.resolve(error) },
    );

    await queue.add('explode', { y: 1 }, { attempts: 1 });

    const event = await failedEvent.promise;
    expect(event.error).toBe('boom');
    expect(event.attempt).toBe(1);

    const error = await failedListener.promise;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('boom');
  });

  test('retries with backoff before failing terminally', async () => {
    const name = uniqueName();
    const attempts: number[] = [];
    const terminal = deferred<void>();
    mochiEvents.on('queue:failed', (e) => {
      if (e.attempt === 2) {
        terminal.resolve();
      }
    });

    const queue = createQueue<null>(name, async (job) => {
      attempts.push(job.attempt);
      throw new Error('always');
    });

    await queue.add('flaky', null, { attempts: 2, backoff: { type: 'fixed', delay: 30 } });
    await terminal.promise;
    expect(attempts).toEqual([1, 2]);
  });

  test('queue:lockDurationMs is resolved once per queue, after the per-queue option', () => {
    const seen: Array<{ value: number; queue: string; explicit: boolean }> = [];
    initExtensions({ filters: { 'queue:lockDurationMs': (value, ctx) => (seen.push({ value, ...ctx }), value) } });

    const defaulted = uniqueName();
    const chosen = uniqueName();
    try {
      createQueue(defaulted, async () => null);
      createQueue(chosen, async () => null, { lockDuration: 5000 });
    } finally {
      initExtensions({});
    }

    expect(seen).toEqual([
      { value: DEFAULT_LOCK_DURATION_MS, queue: defaulted, explicit: false },
      { value: 5000, queue: chosen, explicit: true },
    ]);
  });

  test('the processor receives a plain data job, not an engine handle', async () => {
    const name = uniqueName();
    const seen = deferred<MochiJob<unknown>>();

    const queue = createQueue(name, async (job) => {
      seen.resolve(job);
      return null;
    });

    await queue.add('probe', { hello: 'world' });

    const job = await seen.promise;
    expect(Object.keys(job).sort()).toEqual(['attempt', 'data', 'enqueuedAt', 'id', 'name', 'queue']);
  });

  test('a database string is shared per path and survives a full teardown', async () => {
    const name = uniqueName();
    const database = fileDatabase('persist');
    const queue = createQueue<{ v: number }>(name, async () => null, { database });
    // Far-future delay: the row must still be pending when we inspect the file.
    await queue.add('later', { v: 1 }, { delay: 60_000 });
    await closeAllQueueResources();

    const sql = new SQL(database);
    const rows: Array<{ queue: string; status: string }> = await sql`SELECT queue, status FROM mochi_jobs`;
    expect(rows).toEqual([{ queue: name, status: 'pending' }]);
    await sql.close();
  });

  test('a user-provided SQL instance is used directly and never closed by the queue layer', async () => {
    const sql = new SQL('sqlite://:memory:');
    const a = uniqueName();
    const b = uniqueName();
    const done = deferred<void>();
    createQueue<null>(a, async () => done.resolve(), { database: sql });
    const queueB = createQueue<null>(b, async () => null, { database: sql });
    await getQueue(a).add('job', null);
    await queueB.add('later', null, { delay: 60_000 });
    await done.promise;

    await closeAllQueueResources();
    // Both queues shared one table in the caller's database, and it is still open.
    const rows: Array<{ queue: string }> = await sql`SELECT queue FROM mochi_jobs`;
    expect(rows).toEqual([{ queue: b }]);
    await sql.close();
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

  test('recovery is single-flight across boots sharing a database, until the lease TTL', async () => {
    const name = uniqueName();
    const database = fileDatabase('recovery-lease');
    const boot = async (options?: { recoveryLeaseMs?: number }): Promise<boolean> => {
      let ran = false;
      createQueue(name, async () => null, { database, ...options });
      await runQueueRecovery([[name, { options: { database, ...options }, recover: () => void (ran = true) }]]);
      await closeAllQueueResources();
      return ran;
    };

    expect(await boot({ recoveryLeaseMs: 200 })).toBe(true);
    // A second boot inside the TTL window skips recovery — the first boot's work stands.
    expect(await boot({ recoveryLeaseMs: 200 })).toBe(false);
    await Bun.sleep(250);
    expect(await boot({ recoveryLeaseMs: 200 })).toBe(true);
  });

  test('a failed recovery releases its lease so the next boot retries immediately', async () => {
    const name = uniqueName();
    const database = fileDatabase('recovery-release');
    setLogLevel('silent');
    try {
      createQueue(name, async () => null, { database });
      await runQueueRecovery([
        [
          name,
          {
            options: { database },
            recover: () => {
              throw new Error('store unavailable');
            },
          },
        ],
      ]);
      await closeAllQueueResources();

      let ran = false;
      createQueue(name, async () => null, { database });
      await runQueueRecovery([[name, { options: { database }, recover: () => void (ran = true) }]]);
      expect(ran).toBe(true);
    } finally {
      setLogLevel('warn');
    }
  });

  test('a throwing recover is contained and reported on the event bus', async () => {
    const name = uniqueName();
    createQueue(name, async () => null);
    const errors: Array<{ queue: string; error: string }> = [];
    mochiEvents.on('queue:error', (e) => errors.push(e));
    setLogLevel('silent');
    try {
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
    } finally {
      setLogLevel('warn');
    }

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
    await expect(closeAllQueueResources()).resolves.toBeUndefined();
  });
});
