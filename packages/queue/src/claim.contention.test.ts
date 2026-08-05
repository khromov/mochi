import { afterAll, expect, test } from 'bun:test';
import { createQueue } from './index';
import { tempSqliteDb, waitFor } from './__fixtures__/testUtil';

const db = tempSqliteDb();
afterAll(() => db.cleanup());

test('two instances on one database each process every job exactly once', async () => {
  const runs = new Map<string, number>();
  const record = (id: string) => runs.set(id, (runs.get(id) ?? 0) + 1);
  const options = {
    database: db.url,
    concurrency: 4,
    pollInterval: 25,
    process: async (job: { id: string }) => {
      record(job.id);
      await Bun.sleep(2);
    },
  };
  const a = createQueue<null>('contended', options);
  const b = createQueue<null>('contended', options);

  const refs = await a.addBulk(Array.from({ length: 50 }, () => ({ name: 'j', data: null })));
  await waitFor(() => runs.size === 50, 15_000, 'all 50 jobs to run');
  await Bun.sleep(100);

  expect(runs.size).toBe(50);
  for (const ref of refs) {
    expect(runs.get(ref.id)).toBe(1);
  }
  await Promise.all([a.close(), b.close()]);
  // Two engines fsync-ing a shared WAL file are disk-bound on CI runners — far past bun's 5s default.
}, 30_000);
