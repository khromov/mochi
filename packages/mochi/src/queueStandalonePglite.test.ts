import { afterAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { Mochi } from './Mochi';
import { closeAllQueueResources, getBoss, mountQueues, startQueueRuntime } from './queue';
import { mochiEvents } from './events';
import { resetStartupMilestones } from './lifecycle';

// The standalone lazy-connect + no-resync contract on the embedded pglite backend, mirroring queueStandalone.test.ts's
// sqlite coverage; the caller owns the PGlite instance, so this test closes it itself.
describe('standalone queue producer on pglite storage', () => {
  let db: PGlite;

  afterAll(async () => {
    mochiEvents.all.clear();
    resetStartupMilestones();
    await closeAllQueueResources();
    await db?.close();
  });

  test('lazily connects producer-only and never re-syncs consumer-owned options', async () => {
    db = await PGlite.create();

    // A consumer deployment mounts the queue with its own settings first.
    await startQueueRuntime({ pglite: db });
    await mountQueues([{ name: 'pglite-standalone', options: { expireInSeconds: 42, retryLimit: 7 } }]);
    expect((await getBoss().getQueue('pglite-standalone'))?.expireInSeconds).toBe(42);
    await closeAllQueueResources();

    // A bare producer's first add reconnects lazily, registers no worker, and leaves the stored options alone.
    const producer = Mochi.queue<{ n: number }>('pglite-standalone', { storage: { pglite: db }, expireInSeconds: 900, retryLimit: 1 });
    const jobId = await producer.add({ n: 1 });
    expect(jobId).toBeString();
    expect(getBoss().getWipData()).toHaveLength(0);
    expect((await getBoss().getJobById('pglite-standalone', jobId!))?.state).toBe('created');
    const stored = await getBoss().getQueue('pglite-standalone');
    expect(stored?.expireInSeconds).toBe(42);
    expect(stored?.retryLimit).toBe(7);

    // Mochi.stop() drains the runtime but must not close the caller-owned instance.
    await Mochi.stop();
    const { rows } = await db.query<{ ok: number }>('SELECT 1 AS ok');
    expect(rows[0]?.ok).toBe(1);
  }, 30_000);
});
