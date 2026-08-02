import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { closeAllQueueResources } from './queue';

// Its own file because `Mochi.serve()` may only be called once per process.
const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-recover-'));

let server: Server<undefined> | undefined;

afterAll(async () => {
  server?.stop(true);
  await closeAllQueueResources();
  rmSync(outDir, { recursive: true, force: true });
});

test('recover() runs after every queue mounts and can enqueue through its handle', async () => {
  const processed: string[] = [];
  let sawSibling = false;
  const drained = Promise.withResolvers<void>();

  server = await Mochi.serve({
    port: 0,
    development: false,
    logger: { enabled: false },
    outDir,
    routes: {},
    queues: {
      'recover-primary': Mochi.queue<{ id: string }>({
        process: async (job) => {
          processed.push(job.data.id);
          drained.resolve();
        },
        recover: async (queue) => {
          // A sibling declared later in the map is already mounted, because
          // recovery runs after the whole map is created.
          sawSibling = Mochi.getQueue('recover-sibling').name === 'recover-sibling';
          await queue.push({ id: 'stranded-1' });
        },
      }),
      'recover-sibling': Mochi.queue({ process: async () => null }),
    },
  });

  await drained.promise;
  expect(processed).toEqual(['stranded-1']);
  expect(sawSibling).toBe(true);
});
