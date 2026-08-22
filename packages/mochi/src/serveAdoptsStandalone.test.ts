import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { closeAllQueueResources } from './queue';
import { resetStartupMilestones } from './lifecycle';

// A producer script's lazy standalone runtime and a later Mochi.serve() in the same process: serve on the same
// storage adopts the running boss (and its backlog); serve on a different storage must refuse.
describe('Mochi.serve() over a standalone queue runtime', () => {
  let server: Server<undefined> | undefined;
  let outDir: string;

  afterAll(async () => {
    server?.stop(true);
    await closeAllQueueResources();
    resetStartupMilestones();
    rmSync(outDir, { recursive: true, force: true });
  });

  test('rejects a serve whose queueStorage differs from the connected standalone runtime', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-adopts-'));
    const file = path.join(outDir, 'shared.sqlite');
    const processed: Array<{ n: number }> = [];
    let resolveProcessed!: () => void;
    const firstProcessed = new Promise<void>((r) => {
      resolveProcessed = r;
    });

    const jobs = Mochi.queue<{ n: number }>('adopted-jobs', {
      storage: { sqlite: file },
      pollingIntervalSeconds: 0.5,
      process: async (job) => {
        processed.push(job.data);
        resolveProcessed();
      },
    });

    // Standalone connect first (producer-only: nothing processes the job yet).
    await jobs.add({ n: 41 });

    // The descriptor-vs-queueStorage contradiction rejects during validation, before the config singleton pins.
    await expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        outDir,
        routes: {},
        queueStorage: { sqlite: path.join(outDir, 'other.sqlite') },
        queues: [jobs],
      }),
    ).rejects.toThrow(/declares a different storage — an app has one queue storage/);

    // Same storage: serve adopts the running boss, mounts the worker, and the pre-added job drains.
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {},
      queueStorage: { sqlite: file },
      queues: [jobs],
    });

    await firstProcessed;
    expect(processed).toEqual([{ n: 41 }]);
  }, 20_000);
});
