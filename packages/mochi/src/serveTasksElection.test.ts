import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { SqlLeaseStore } from './tasks/lease';
import { clearTasks } from './tasks/tasks';
import { resetStartupMilestones } from './lifecycle';

// One Mochi.serve() per file — see serveTasks.test.ts.
let server: Server<undefined> | undefined;
const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-tasks-election-'));
const leaseUrl = `sqlite://${path.join(outDir, 'lease.db')}`;

afterAll(async () => {
  await server?.stop(true);
  clearTasks();
  resetStartupMilestones();
  rmSync(outDir, { recursive: true, force: true });
});

test('elects itself through a real lease store, runs the task, and releases on shutdown', async () => {
  let resolveFired!: () => void;
  const fired = new Promise<void>((resolve) => {
    resolveFired = resolve;
  });

  server = await Mochi.serve({
    port: 0,
    development: false,
    logger: { enabled: false },
    outDir,
    routes: {},
    tasks: { elected: Mochi.task({ cron: '* * * * * *', run: () => resolveFired() }) },
    scheduler: {
      leader: true,
      // No jitter: a single node should elect itself immediately.
      startupJitter: 0,
      // Long enough that only an explicit release can clear it — the point of the assertion below.
      leaseTtl: 60_000,
      lease: { url: leaseUrl },
    },
  });

  await fired;

  // A separate connection, so this reads what actually landed on disk.
  const observer = new SqlLeaseStore({ url: leaseUrl });
  const held = await observer.read();
  expect(held).not.toBeNull();
  expect(held?.owner).toBeString();

  await server.stop(true);
  server = undefined;

  // Released rather than left to age out for a full minute, so a peer takes over now.
  expect(await observer.read()).toBeNull();
  await observer.close();
}, 20_000);
