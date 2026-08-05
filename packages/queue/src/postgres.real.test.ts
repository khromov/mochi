import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createQueue } from './index';
import { claimJobs, ensureSchema } from './db';
import { waitFor } from './__fixtures__/testUtil';

// Gated on a real server (CI provides a postgres service container; set QUEUE_POSTGRES_URL
// to run locally). PGlite's socket server accepts a single connection, so only a real
// server exercises FOR UPDATE SKIP LOCKED across genuinely concurrent sessions — the
// property the multi-instance claim path stakes exactly-once on.
const url = process.env.QUEUE_POSTGRES_URL;

describe.skipIf(!url)('postgres (real server, concurrent sessions)', () => {
  let a: SQL;
  let b: SQL;

  beforeAll(async () => {
    a = new SQL(url!, { max: 4 });
    b = new SQL(url!, { max: 4 });
    await ensureSchema(a, 'postgres');
  });

  afterAll(async () => {
    await Promise.all([a.close(), b.close()]);
  });

  test('simultaneous claims from concurrent sessions never hand out the same job', async () => {
    const queue = `real-claims-${Bun.randomUUIDv7()}`;
    const now = Date.now();
    await a`INSERT INTO mochi_jobs ${a(
      Array.from({ length: 40 }, (_, i) => ({
        queue,
        id: `job-${i}`,
        name: 'j',
        data: 'null',
        status: 'pending',
        priority: 0,
        run_at: now - 1000,
        attempts_made: 0,
        max_attempts: 1,
        backoff_type: null,
        backoff_delay: null,
        lease_token: null,
        lease_expires_at: null,
        created_at: now - 1000,
      })),
    )}`;

    const rounds = await Promise.all([
      claimJobs(a, 'postgres', queue, 10, 'token-a1', now, 60_000),
      claimJobs(b, 'postgres', queue, 10, 'token-b1', now, 60_000),
      claimJobs(a, 'postgres', queue, 10, 'token-a2', now, 60_000),
      claimJobs(b, 'postgres', queue, 10, 'token-b2', now, 60_000),
    ]);
    const claimed = rounds.flat().map((row) => row.id);
    expect(new Set(claimed).size).toBe(claimed.length);

    // A concurrent scan may see fewer than `limit` unlocked rows; a final sweep proves the
    // contention lost none of them.
    const sweep = await claimJobs(a, 'postgres', queue, 40, 'token-sweep', now, 60_000);
    const all = [...claimed, ...sweep.map((row) => row.id)];
    expect(new Set(all).size).toBe(40);
    expect(all).toHaveLength(40);
  });

  test('two pooled engine instances drain a shared queue with every job processed exactly once', async () => {
    const name = `real-contended-${Bun.randomUUIDv7()}`;
    const runs = new Map<string, number>();
    const make = (sql: SQL) =>
      createQueue<null>(name, {
        database: sql,
        concurrency: 4,
        pollInterval: 25,
        process: async (job) => {
          runs.set(job.id, (runs.get(job.id) ?? 0) + 1);
          await Bun.sleep(2);
        },
      });
    const qa = make(a);
    const qb = make(b);
    const refs = await qa.addBulk(Array.from({ length: 60 }, () => ({ name: 'j', data: null })));
    await waitFor(() => runs.size === 60, 20_000, 'all 60 jobs to run');
    await Bun.sleep(150);
    for (const ref of refs) {
      expect(runs.get(ref.id)).toBe(1);
    }
    await Promise.all([qa.close(), qb.close()]);
  }, 30_000);

  test('the recovery lease is single-flight across concurrent sessions', async () => {
    const name = `real-recover-${Bun.randomUUIDv7()}`;
    const qa = createQueue<null>(name, { database: a, pollInterval: 0, process: () => {} });
    const qb = createQueue<null>(name, { database: b, pollInterval: 0, process: () => {} });
    const results = await Promise.all([qa.tryRecoveryLease(), qb.tryRecoveryLease()]);
    expect(results.toSorted()).toEqual([false, true]);
    await Promise.all([qa.close(), qb.close()]);
  });
});
