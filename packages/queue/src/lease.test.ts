import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createQueue, LeaseLostError, type Job } from './index';
import { ensureSchema } from './db';
import { waitFor } from './__fixtures__/testUtil';

async function seedExpiredActiveRow(sql: SQL, queue: string, id: string, attemptsMade: number, maxAttempts: number): Promise<void> {
  await ensureSchema(sql, 'sqlite');
  const now = Date.now();
  await sql`INSERT INTO mochi_jobs ${sql([
    {
      queue,
      id,
      name: 'j',
      data: 'null',
      status: 'active',
      priority: 0,
      run_at: now - 1000,
      attempts_made: attemptsMade,
      max_attempts: maxAttempts,
      backoff_type: null,
      backoff_delay: null,
      lease_token: 'crashed-instance-token',
      lease_expires_at: now - 500,
      created_at: now - 1000,
    },
  ])}`;
}

test('a job whose holder crashed is reclaimed after lease expiry, with the crashed claim counted as an attempt', async () => {
  const sql = new SQL('sqlite://:memory:');
  await seedExpiredActiveRow(sql, 'reclaim', 'stranded', 1, 2);
  const runs: Job<null>[] = [];
  const queue = createQueue<null>('reclaim', {
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
  await sql.close();
});

test('a reclaim past max_attempts fails terminally without running the processor', async () => {
  const sql = new SQL('sqlite://:memory:');
  await seedExpiredActiveRow(sql, 'spent', 'stranded', 1, 1);
  let processed = 0;
  const failures: Array<{ message: string; willRetry: boolean }> = [];
  const queue = createQueue<null>('spent', {
    database: sql,
    pollInterval: 25,
    process: () => {
      processed++;
    },
    on: { failed: (_job, error, info) => failures.push({ message: error.message, willRetry: info.willRetry }) },
  });
  await waitFor(() => failures.length === 1);
  expect(processed).toBe(0);
  expect(failures[0]!.willRetry).toBe(false);
  expect(failures[0]!.message).toContain('lease expired');
  const rows: unknown[] = await sql`SELECT id FROM mochi_jobs`;
  expect(rows).toHaveLength(0);
  await queue.close();
  await sql.close();
});

test('a slow holder that lost its lease settles as a token-guarded no-op, never a double completion', async () => {
  const sql = new SQL('sqlite://:memory:');
  const aCompleted: string[] = [];
  const aErrors: Error[] = [];
  const bCompleted: Array<{ id: string; attempt: number }> = [];

  // Instance A: heartbeat disabled to simulate a stalled instance whose lease silently expires.
  const a = createQueue<null, string>('stolen', {
    database: sql,
    lockDuration: 120,
    heartbeatInterval: 0,
    pollInterval: 10_000,
    defaultJobOptions: { attempts: 3 },
    process: async () => {
      await Bun.sleep(400);
      return 'from-a';
    },
    on: {
      completed: (job) => aCompleted.push(job.id),
      error: (err) => aErrors.push(err),
    },
  });
  const b = createQueue<null, string>('stolen', {
    database: sql,
    lockDuration: 120,
    pollInterval: 25,
    defaultJobOptions: { attempts: 3 },
    process: () => 'from-b',
    on: { completed: (job, _result, _info) => bCompleted.push({ id: job.id, attempt: job.attempt }) },
  });

  const ref = await a.add('j', null);
  await waitFor(() => bCompleted.length === 1, 5000, 'instance B to reclaim and complete');
  expect(bCompleted[0]).toEqual({ id: ref.id, attempt: 2 });

  await waitFor(() => aErrors.length === 1, 5000, "instance A's late settle to surface as an error");
  expect(aErrors[0]).toBeInstanceOf(LeaseLostError);
  expect(aCompleted).toEqual([]);

  await Promise.all([a.close(), b.close()]);
  await sql.close();
});
