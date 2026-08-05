import { describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { backoffDelay } from './backoff';
import { createQueue, type JobFailInfo } from './index';
import { waitFor } from './__fixtures__/testUtil';

describe('backoffDelay', () => {
  test('fixed returns the base delay for every attempt', () => {
    expect(backoffDelay({ type: 'fixed', delay: 500 }, 1)).toBe(500);
    expect(backoffDelay({ type: 'fixed', delay: 500 }, 4)).toBe(500);
  });

  test('exponential doubles per attempt', () => {
    expect(backoffDelay({ type: 'exponential', delay: 100 }, 1)).toBe(100);
    expect(backoffDelay({ type: 'exponential', delay: 100 }, 2)).toBe(200);
    expect(backoffDelay({ type: 'exponential', delay: 100 }, 3)).toBe(400);
  });

  test('no backoff or non-positive delay means retry immediately', () => {
    expect(backoffDelay(undefined, 2)).toBe(0);
    expect(backoffDelay({ type: 'fixed', delay: 0 }, 2)).toBe(0);
  });
});

describe('retries', () => {
  test('a failed attempt is rescheduled with the backoff delay stamped into run_at', async () => {
    const sql = new SQL('sqlite://:memory:');
    let failedAt = 0;
    const fails: JobFailInfo[] = [];
    const queue = createQueue<null>('backoff-runat', {
      database: sql,
      // Long enough that the retry never actually runs during the test — we assert on the row.
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
      process: () => {
        failedAt = Date.now();
        throw new Error('nope');
      },
      on: { failed: (_job, _err, info) => fails.push(info) },
    });
    await queue.add('j', null);
    await waitFor(() => fails.length === 1);
    expect(fails[0]!.willRetry).toBe(true);

    const rows: Array<{ status: string; attempts_made: number; run_at: number }> = await sql`SELECT status, attempts_made, run_at FROM mochi_jobs`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    expect(Number(rows[0]!.attempts_made)).toBe(1);
    const delta = Number(rows[0]!.run_at) - failedAt;
    expect(delta).toBeGreaterThanOrEqual(59_000);
    expect(delta).toBeLessThanOrEqual(61_000);
    await queue.close();
    await sql.close();
  });

  test('exponential backoff grows across attempts', async () => {
    const sql = new SQL('sqlite://:memory:');
    const runAts: number[] = [];
    const failTimes: number[] = [];
    const queue = createQueue<null>('backoff-grows', {
      database: sql,
      pollInterval: 20,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 100 } },
      process: () => {
        failTimes.push(Date.now());
        throw new Error('nope');
      },
      on: {
        failed: () => {
          void sql`SELECT run_at FROM mochi_jobs`.then((rows: Array<{ run_at: number }>) => {
            if (rows[0]) {
              runAts.push(Number(rows[0].run_at));
            }
          });
        },
      },
    });
    await queue.add('j', null);
    await waitFor(() => failTimes.length === 3, 10_000, 'three attempts');
    // attempt 1 → +100ms, attempt 2 → +200ms; the upper bounds only cap the settle-write
    // lag after the throw, so they carry generous slack for a loaded runner.
    expect(runAts[0]! - failTimes[0]!).toBeGreaterThanOrEqual(90);
    expect(runAts[0]! - failTimes[0]!).toBeLessThanOrEqual(450);
    expect(runAts[1]! - failTimes[1]!).toBeGreaterThanOrEqual(190);
    expect(runAts[1]! - failTimes[1]!).toBeLessThanOrEqual(650);
    await queue.close();
    await sql.close();
  });

  test('exhausted attempts fail terminally and delete the row', async () => {
    const sql = new SQL('sqlite://:memory:');
    const willRetries: boolean[] = [];
    const queue = createQueue<null>('exhausted', {
      database: sql,
      pollInterval: 20,
      defaultJobOptions: { attempts: 2 },
      process: () => {
        throw new Error('always');
      },
      on: { failed: (_job, _err, info) => willRetries.push(info.willRetry) },
    });
    await queue.add('j', null);
    await waitFor(() => willRetries.length === 2);
    expect(willRetries).toEqual([true, false]);
    await Bun.sleep(50);
    const rows: unknown[] = await sql`SELECT id FROM mochi_jobs`;
    expect(rows).toHaveLength(0);
    await queue.close();
    await sql.close();
  });

  test('per-job options override defaultJobOptions', async () => {
    const attempts: number[] = [];
    const queue = createQueue<null>('per-job', {
      pollInterval: 10,
      defaultJobOptions: { attempts: 5 },
      process: (job) => {
        attempts.push(job.attempt);
        throw new Error('always');
      },
    });
    await queue.add('j', null, { attempts: 1 });
    await waitFor(() => attempts.length === 1);
    await Bun.sleep(100);
    expect(attempts).toEqual([1]);
    await queue.close();
  });
});
