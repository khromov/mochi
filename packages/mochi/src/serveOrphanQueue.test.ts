import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Mochi } from './Mochi';
import { closeAllQueueResources } from './queue';

// Its own file: Mochi.serve() can be called only once per process (the
// __mochi_config__ singleton), so the one serve here is the single allowed call.
describe('Mochi.serve() orphan-queue guard', () => {
  let outDir: string;

  afterAll(async () => {
    await closeAllQueueResources();
    if (outDir) {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('is fatal when a queue producer has no worker mounted', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-orphan-'));
    Mochi.queue('lonely-queue');

    // Rejects before binding a port, so no half-started server is left listening.
    await expect(Mochi.serve({ port: 0, development: false, logger: { enabled: false }, outDir, routes: {} })).rejects.toThrow(/lonely-queue.*no worker mounted/);
  });
});
