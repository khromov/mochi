import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createQueue, closeAllQueueResources } from './queue';
import type { MochiJob, MochiQueueBackend } from './queue';
import type { MochiQueueFailedEvent } from './events';
import { mochiEvents } from './events';
import { resetStartupMilestones } from './lifecycle';
import { startTestPostgres } from './__fixtures__/postgres/startTestPostgres';
import type { TestPostgres } from './__fixtures__/postgres/startTestPostgres';

// End-to-end coverage of the postgres queue backend against the in-process PGlite fixture (real wire protocol, no
// external service). Set MOCHI_TEST_PG_URL=postgresql://user:pass@host:5432/db to run against a real server instead.
// Note PGlite's socket bridge multiplexes one session, so NOTIFY push never reaches the listener — delivery rides the
// driver's polling, which is the path these tests exercise (hence the short pollInterval).
const REAL_PG_URL = process.env.MOCHI_TEST_PG_URL;

let fixture: TestPostgres | null = null;
let pgUrl: string;

// PGlite's WASM boot can take ~10s on slow machines — well past the default hook budget.
beforeAll(async () => {
  if (REAL_PG_URL) {
    pgUrl = REAL_PG_URL;
    return;
  }
  fixture = await startTestPostgres();
  pgUrl = fixture.url;
}, 60_000);

afterAll(async () => {
  await fixture?.close();
}, 20_000);

let counter = 0;
const uniqueName = (): string => `pg_q_${counter++}`;

const backend = (): MochiQueueBackend => ({ postgres: pgUrl, fedify: { pollInterval: { milliseconds: 100 } } });

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
}, 20_000);

describe('Mochi queue (postgres)', () => {
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
    const job = await seen.promise;
    expect(job.data).toEqual({ to: 'alice@example.com' });
    expect(job.id).toBe(ref.id);
    expect(job.attempt).toBe(1);
  }, 15_000);

  test('retries a failing job with willRetry flags', async () => {
    const name = uniqueName();
    const failures: MochiQueueFailedEvent[] = [];
    const exhausted = deferred<void>();

    mochiEvents.on('queue:failed', (e) => {
      failures.push(e);
      if (!e.willRetry) {
        exhausted.resolve();
      }
    });

    const queue = await createQueue<{ n: number }>(
      name,
      async (job) => {
        throw new Error(`fail #${job.attempt}`);
      },
      { backend: backend(), backoff: { type: 'fixed', delay: 10 } },
    );

    await queue.add('retry-me', { n: 1 }, { attempts: 2 });
    await exhausted.promise;
    expect(failures.map((f) => f.attempt)).toEqual([1, 2]);
    expect(failures.map((f) => f.willRetry)).toEqual([true, false]);
  }, 20_000);

  test('depth() reports waiting messages', async () => {
    const name = uniqueName();
    const queue = await createQueue(name, async () => null, { backend: backend() });

    await queue.add('someday', { v: 1 }, { delay: 60_000 });

    const depth = await queue.depth();
    expect(depth).toBeDefined();
    expect(depth!.queued).toBe(1);
    expect(depth!.delayed).toBe(1);
  }, 15_000);

  test('a persisted job survives a close and remount', async () => {
    const name = uniqueName();

    const before = await createQueue(name, async () => null, { backend: backend() });
    // Far enough out that the first mount cannot deliver it before we close.
    await before.add('survivor', { v: 1 }, { delay: 1500 });
    await closeAllQueueResources();

    const seen = deferred<MochiJob<unknown>>();
    await createQueue(
      name,
      async (job) => {
        seen.resolve(job);
      },
      { backend: backend() },
    );

    const job = await seen.promise;
    expect(job.name).toBe('survivor');
    expect(job.data).toEqual({ v: 1 });
  }, 20_000);

  test('closeAllQueueResources drains and closes the shared client', async () => {
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
    // A second close is a no-op even though the sql client is already ended.
    await closeAllQueueResources();
  }, 20_000);
});
