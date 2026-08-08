import { afterAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { startQueueRuntime, mountQueues, getQueue, closeAllQueueResources } from './queue';
import type { MochiJob } from './queue';
import { mochiEvents } from './events';
import { resetStartupMilestones } from './lifecycle';

// Exercises the `{ pglite: instance }` storage path — bun-boss's embedded pglite backend, no wire protocol —
// proving the mochi_queue schema installs and jobs round-trip. The postgres path over the wire is covered by
// queuePostgres.test.ts; the caller owns the PGlite instance, so this test closes it itself.
describe('Mochi queue on pglite storage', () => {
  let db: PGlite;

  afterAll(async () => {
    mochiEvents.all.clear();
    resetStartupMilestones();
    await closeAllQueueResources();
    await db?.close();
  });

  test('installs its schema and roundtrips a job in-process', async () => {
    db = await PGlite.create();
    const seen: Array<MochiJob<{ n: number }>> = [];
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });

    await startQueueRuntime({ pglite: db });
    await mountQueues([
      [
        'pglite-jobs',
        {
          process: async (job: MochiJob<{ n: number }>) => {
            seen.push(job);
            resolveDone();
            return { ok: true };
          },
          options: { pollingIntervalSeconds: 0.5 },
        },
      ],
    ]);

    const jobId = await getQueue<{ n: number }>('pglite-jobs').add({ n: 41 });
    expect(jobId).toBeString();
    await done;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.data).toEqual({ n: 41 });
    expect(seen[0]?.attempt).toBe(1);

    // The queue tables must live in the namespaced schema, not the user's public schema.
    const { rows } = await db.query<{ table_schema: string }>("SELECT DISTINCT table_schema FROM information_schema.tables WHERE table_name = 'job'");
    expect(rows.map((r) => r.table_schema)).toEqual(['mochi_queue']);

    // Mochi must not close a caller-owned instance on teardown; prove it stays usable after the runtime drains.
    await closeAllQueueResources();
    const { rows: after } = await db.query<{ ok: number }>('SELECT 1 AS ok');
    expect(after[0]?.ok).toBe(1);
  }, 30_000);
});
