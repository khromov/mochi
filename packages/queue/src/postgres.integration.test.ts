import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createQueue, type Job } from './index';
import { startTestPostgres, type TestPostgres } from './__fixtures__/startTestPostgres';
import { waitFor } from './__fixtures__/testUtil';

// Exercises the real Postgres dialect (CTE claim with FOR UPDATE SKIP LOCKED, string-typed
// BIGINT columns) against an in-process PGlite server. PGlite's socket server accepts a
// single connection, so every engine instance shares one `SQL` handle (max: 1) — the claim
// statements are single atomic UPDATEs, so multi-instance correctness doesn't depend on
// separate sessions.
describe('postgres adapter', () => {
  let pg: TestPostgres;
  let sql: SQL;

  beforeAll(async () => {
    pg = await startTestPostgres();
    sql = new SQL(pg.url, { max: 1 });
  });

  afterAll(async () => {
    await sql.close();
    await pg.close();
  });

  test('roundtrip: job fields come back as plain numbers despite pg BIGINT strings', async () => {
    const seen: Job<{ n: number }>[] = [];
    const queue = createQueue<{ n: number }>('pg-roundtrip', {
      database: sql,
      process: (job) => {
        seen.push(job);
      },
    });
    const before = Date.now();
    await queue.add('j', { n: 7 }, { delay: 0 });
    await waitFor(() => seen.length === 1);
    const job = seen[0]!;
    expect(job.data).toEqual({ n: 7 });
    expect(job.attempt).toBe(1);
    expect(typeof job.attempt).toBe('number');
    expect(typeof job.enqueuedAt).toBe('number');
    expect(job.enqueuedAt).toBeGreaterThanOrEqual(before);
    await queue.close();
  });

  test('two engine instances drain a shared queue with every job processed exactly once', async () => {
    const runs = new Map<string, number>();
    const make = () =>
      createQueue<null>('pg-contended', {
        database: sql,
        concurrency: 3,
        pollInterval: 25,
        process: async (job) => {
          runs.set(job.id, (runs.get(job.id) ?? 0) + 1);
          await Bun.sleep(2);
        },
      });
    const a = make();
    const b = make();
    const refs = await a.addBulk(Array.from({ length: 20 }, () => ({ name: 'j', data: null })));
    await waitFor(() => runs.size === 20, 15_000, 'all 20 jobs to run');
    await Bun.sleep(100);
    for (const ref of refs) {
      expect(runs.get(ref.id)).toBe(1);
    }
    await Promise.all([a.close(), b.close()]);
  }, 30_000);

  test('an expired lease is reclaimed and retried', async () => {
    const now = Date.now();
    await sql`INSERT INTO mochi_jobs ${sql([
      {
        queue: 'pg-reclaim',
        id: 'stranded',
        name: 'j',
        data: 'null',
        status: 'active',
        priority: 0,
        run_at: now - 1000,
        attempts_made: 1,
        max_attempts: 2,
        backoff_type: null,
        backoff_delay: null,
        lease_token: 'crashed-instance-token',
        lease_expires_at: now - 500,
        created_at: now - 1000,
      },
    ])}`;
    const runs: Job<null>[] = [];
    const queue = createQueue<null>('pg-reclaim', {
      database: sql,
      pollInterval: 25,
      process: (job) => {
        runs.push(job);
      },
    });
    await waitFor(() => runs.length === 1);
    expect(runs[0]!.id).toBe('stranded');
    expect(runs[0]!.attempt).toBe(2);
    await queue.close();
  });

  test('recovery lease is single-flight and reopens on release', async () => {
    const make = () => createQueue<null>('pg-recover', { database: sql, pollInterval: 0, process: () => {} });
    const a = make();
    const b = make();
    const results = await Promise.all([a.tryRecoveryLease(), b.tryRecoveryLease()]);
    expect(results.toSorted()).toEqual([false, true]);
    await a.releaseRecoveryLease();
    expect(await b.tryRecoveryLease()).toBe(true);
    await Promise.all([a.close(), b.close()]);
  });
});
