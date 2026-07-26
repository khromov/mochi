import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { clearTasks } from './tasks/tasks';
import { resetStartupMilestones } from './lifecycle';

// One Mochi.serve() per file — see serveTasks.test.ts.
let server: Server<undefined> | undefined;
const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-tasks-errors-'));

afterAll(async () => {
  await server?.stop(true);
  clearTasks();
  resetStartupMilestones();
  rmSync(outDir, { recursive: true, force: true });
});

test('a task that throws on every tick leaves the server serving', async () => {
  let resolveThrew!: () => void;
  const threw = new Promise<void>((resolve) => {
    resolveThrew = resolve;
  });

  server = await Mochi.serve({
    port: 0,
    development: false,
    logger: { enabled: false },
    outDir,
    routes: { '/ok': Mochi.api(() => Response.json({ ok: true })) },
    tasks: {
      exploding: Mochi.task({
        cron: '* * * * * *',
        run: () => {
          resolveThrew();
          throw new Error('scheduled failure');
        },
      }),
    },
    scheduler: { leader: false },
  });

  await threw;
  // Give the scheduler a couple more ticks to fail again — a crash would surface here.
  await Bun.sleep(1_200);

  const response = await fetch(`http://localhost:${server.port}/ok`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
}, 20_000);
