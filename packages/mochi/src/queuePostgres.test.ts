import { afterAll, describe, expect, test } from 'bun:test';
import { startQueueRuntime, mountQueues, getQueue, closeAllQueueResources } from './queue';
import type { MochiJob } from './queue';
import { mochiEvents } from './events';
import { resetStartupMilestones } from './lifecycle';
import { startTestPostgres, type TestPostgres } from './__fixtures__/postgres/startTestPostgres';

// Exercises the `{ postgres: url }` storage path — bun-boss's postgres backend over Bun.SQL on the wire — against an
// in-process PGlite Postgres, proving the mochi_queue schema installs and jobs round-trip. Memory/sqlite have coverage
// in queue.test.ts; this closes the Postgres gap.
describe('Mochi queue on postgres storage', () => {
  let pg: TestPostgres;

  afterAll(async () => {
    mochiEvents.all.clear();
    resetStartupMilestones();
    await closeAllQueueResources();
    await pg?.close();
  });

  test('installs its schema and roundtrips a job over the wire', async () => {
    pg = await startTestPostgres();
    const seen: Array<MochiJob<{ n: number }>> = [];
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });

    await startQueueRuntime({ postgres: pg.url });
    await mountQueues([
      {
        name: 'pg-jobs',
        process: async (job: MochiJob<{ n: number }>) => {
          seen.push(job);
          resolveDone();
          return { ok: true };
        },
        options: { pollingIntervalSeconds: 0.5 },
      },
    ]);

    const jobId = await getQueue<{ n: number }>('pg-jobs').add({ n: 41 });
    expect(jobId).toBeString();
    await done;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.data).toEqual({ n: 41 });
    expect(seen[0]?.attempt).toBe(1);

    // The queue tables must live in the namespaced schema, not the user's public schema.
    const { rows } = await pg.query<{ table_schema: string }>("SELECT DISTINCT table_schema FROM information_schema.tables WHERE table_name = 'job'");
    expect(rows.map((r) => r.table_schema)).toEqual(['mochi_queue']);
  }, 30_000);
});
