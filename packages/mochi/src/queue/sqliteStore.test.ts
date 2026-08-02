import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { SqliteQueueStore } from './sqliteStore';
import { runStoreContract } from './storeContract';
import { createQueue, closeAllQueueResources } from '../queue';
import { resetStartupMilestones } from '../lifecycle';
import { mochiEvents } from '../events';

const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-queue-sqlite-test-'));

let counter = 0;
const uniquePath = (): string => path.join(dataDir, `store-${counter++}.sqlite`);

function call<V>(run: (cb: (err: unknown, value?: V) => void) => void): Promise<V | undefined> {
  return new Promise((resolve, reject) => run((err, value) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(value))));
}

afterEach(async () => {
  mochiEvents.all.clear();
  resetStartupMilestones();
  await closeAllQueueResources();
});

afterAll(async () => {
  // Windows releases SQLite file locks asynchronously; best-effort cleanup, never fail the suite over it.
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
});

describe('SqliteQueueStore', () => {
  test('satisfies the better-queue store contract', async () => {
    await runStoreContract(() => new SqliteQueueStore({ queue: 'contract', path: uniquePath() }));
  });

  test('rejects a tableName that is not a plain identifier', () => {
    expect(() => new SqliteQueueStore({ queue: 'q', path: uniquePath(), tableName: 'tasks; DROP TABLE users' })).toThrow(/plain SQL identifier/);
  });

  test('persists queued tasks across close and reopen', async () => {
    const file = uniquePath();
    const first = new SqliteQueueStore<{ v: number }>({ queue: 'persist', path: file });
    await call((cb) => first.connect(cb));
    await call((cb) => first.putTask('one', { v: 1 }, 0, cb));
    await call((cb) => first.putTask('two', { v: 2 }, 0, cb));
    await call((cb) => first.close(cb));

    const second = new SqliteQueueStore<{ v: number }>({ queue: 'persist', path: file });
    expect(await call<number>((cb) => second.connect(cb))).toBe(2);
    expect(await call<{ v: number }>((cb) => second.getTask('one', cb))).toEqual({ v: 1 });
    await call((cb) => second.close(cb));
  });

  test('two queues sharing one file stay isolated', async () => {
    const file = uniquePath();
    const emails = new SqliteQueueStore<{ v: string }>({ queue: 'emails', path: file });
    const reports = new SqliteQueueStore<{ v: string }>({ queue: 'reports', path: file });
    await call((cb) => emails.connect(cb));
    await call((cb) => reports.connect(cb));

    await call((cb) => emails.putTask('shared-id', { v: 'email' }, 0, cb));
    await call((cb) => reports.putTask('shared-id', { v: 'report' }, 0, cb));

    expect(await call<{ v: string }>((cb) => emails.getTask('shared-id', cb))).toEqual({ v: 'email' });
    expect(await call<{ v: string }>((cb) => reports.getTask('shared-id', cb))).toEqual({ v: 'report' });

    // Claiming everything in one queue leaves the other's rows untouched.
    const lock = await call<string>((cb) => emails.takeFirstN(10, cb));
    await call((cb) => emails.releaseLock(lock!, cb));
    expect(await call<{ v: string }>((cb) => reports.getTask('shared-id', cb))).toEqual({ v: 'report' });

    await call((cb) => emails.close(cb));
    await call((cb) => reports.close(cb));
  });

  // The end-to-end persistence promise: a shutdown mid-backlog leaves jobs in the file, and the next boot's queue
  // (autoResume + store connect) drains them without an explicit recover().
  test('a queue on the same file drains jobs left behind by a previous queue', async () => {
    const file = uniquePath();

    const first = createQueue<{ n: number }>('handoff', async () => null, { store: { type: 'sqlite', path: file } });
    first.pause();
    await first.push({ n: 1 }, { id: 'left-behind' });
    await closeAllQueueResources();

    const drained = new Promise<{ id: string; n: number }>((resolve) => {
      createQueue<{ n: number }>('handoff', async (job) => void resolve({ id: job.id, n: job.data.n }), { store: { type: 'sqlite', path: file } });
    });
    const job = await drained;
    expect(job).toEqual({ id: 'left-behind', n: 1 });
  });
});
