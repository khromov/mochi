import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createQueue } from './index';
import { waitFor } from './__fixtures__/testUtil';

test('a job outliving lockDuration keeps its lease through heartbeats and completes exactly once', async () => {
  const sql = new SQL('sqlite://:memory:');
  const completed: number[] = [];
  const errors: Error[] = [];
  let bRuns = 0;

  const a = createQueue<null>('long-job', {
    database: sql,
    lockDuration: 150,
    pollInterval: 10_000,
    defaultJobOptions: { attempts: 3 },
    process: async (job) => {
      await Bun.sleep(600);
      completed.push(job.attempt);
    },
    on: { error: (err) => errors.push(err) },
  });
  // A hungry second instance that would reclaim the job if the lease ever lapsed.
  const b = createQueue<null>('long-job', {
    database: sql,
    lockDuration: 150,
    pollInterval: 20,
    defaultJobOptions: { attempts: 3 },
    process: () => {
      bRuns++;
    },
  });

  await a.add('j', null);
  await waitFor(() => completed.length === 1, 5000, 'the long job to finish');
  await Bun.sleep(100);

  expect(completed).toEqual([1]);
  expect(bRuns).toBe(0);
  expect(errors).toEqual([]);
  await Promise.all([a.close(), b.close()]);
  await sql.close();
});
