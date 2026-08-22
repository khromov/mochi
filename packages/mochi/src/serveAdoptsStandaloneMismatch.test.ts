import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Mochi } from './Mochi';
import { closeAllQueueResources } from './queue';
import { resetStartupMilestones } from './lifecycle';

// The adoption path re-verifies: serve runs its own create-and-verify over its declaration, so it is checked against
// storage even though the producer already ensured the queue in this process.
describe('Mochi.serve() adopting a standalone runtime re-verifies queue config', () => {
  let outDir: string;

  afterAll(async () => {
    await closeAllQueueResources();
    resetStartupMilestones();
    rmSync(outDir, { recursive: true, force: true });
  });

  test('a serve declaring options that differ from the producer-created queue fails its boot', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-adopt-mismatch-'));
    const file = path.join(outDir, 'shared.sqlite');
    // A bare producer creates the queue first — a fresh create materializes bun-boss defaults (retryLimit 2).
    const producer = Mochi.queue<{ n: number }>('adopt-mismatch', { storage: { sqlite: file } });
    await producer.add({ n: 1 });

    await expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        outDir,
        routes: {},
        queues: [Mochi.queue('adopt-mismatch', { storage: { sqlite: file }, retryLimit: 7, process: async () => null })],
      }),
    ).rejects.toThrow(/"adopt-mismatch" already exists in storage with retryLimit 2, but this code declares retryLimit 7/);
  }, 20_000);
});
