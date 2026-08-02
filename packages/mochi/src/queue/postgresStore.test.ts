import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { PostgresQueueStore } from './postgresStore';
import { runStoreContract } from './storeContract';
import { createQueue, closeAllQueueResources } from '../queue';
import { resetStartupMilestones } from '../lifecycle';
import { mochiEvents } from '../events';
import { startTestPostgres, type TestPostgres } from '../__fixtures__/postgres/startTestPostgres';

// Runs unconditionally against an in-process PGlite Postgres speaking the real wire protocol
// (same fixture as rateLimit.postgres.integration.test.ts) — no external service, no Docker.
// Booted with top-level await: PGlite's WASM instantiation can exceed bun's 5s hook timeout, and module load has none.
const pg: TestPostgres = await startTestPostgres();
// One shared prepare-less pool for every store here: pglite-socket multiplexes all connections onto a single
// immortal PGlite session, where the named prepared statements of successive pools collide (42P05).
const pgSql = new SQL({ url: pg.url, prepare: false });

describe('PostgresQueueStore', () => {
  afterAll(async () => {
    await pgSql.close();
    await pg.close();
  });

  afterEach(async () => {
    mochiEvents.all.clear();
    resetStartupMilestones();
    await closeAllQueueResources();
  });

  const call = <V>(run: (cb: (err: unknown, value?: V) => void) => void): Promise<V | undefined> =>
    new Promise((resolve, reject) => run((err, value) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(value))));

  test('satisfies the better-queue store contract', async () => {
    await runStoreContract(() => new PostgresQueueStore({ queue: 'contract', sql: pgSql }));
  });

  test('rejects a tableName that is not a plain identifier', () => {
    expect(() => new PostgresQueueStore({ queue: 'q', sql: pgSql, tableName: 'tasks; DROP TABLE users' })).toThrow(/plain SQL identifier/);
  });

  test('two queues sharing one table stay isolated', async () => {
    const emails = new PostgresQueueStore<{ v: string }>({ queue: 'emails', sql: pgSql });
    const reports = new PostgresQueueStore<{ v: string }>({ queue: 'reports', sql: pgSql });
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

  // The end-to-end persistence promise: a shutdown mid-backlog leaves jobs in Postgres, and the next boot's queue
  // (autoResume + store connect) drains them without an explicit recover().
  test('a queue on the same database drains jobs left behind by a previous queue', async () => {
    const first = createQueue<{ n: number }>('pg-handoff', async () => null, { store: { type: 'postgres', sql: pgSql } });
    first.pause();
    await first.push({ n: 1 }, { id: 'left-behind' });
    await closeAllQueueResources();

    const drained = new Promise<{ id: string; n: number }>((resolve) => {
      createQueue<{ n: number }>('pg-handoff', async (job) => void resolve({ id: job.id, n: job.data.n }), { store: { type: 'postgres', sql: pgSql } });
    });
    const job = await drained;
    expect(job).toEqual({ id: 'left-behind', n: 1 });
  });
});
