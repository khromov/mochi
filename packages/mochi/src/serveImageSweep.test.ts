import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { mochiEvents } from './events';
import type { MochiImageCacheSweepEvent, MochiTaskLeaderEvent } from './events';
import { clearTasks } from './tasks/tasks';
import { resetStartupMilestones } from './lifecycle';

// One Mochi.serve() per file — see serveTasks.test.ts for why.
let server: Server<undefined> | undefined;
let outDir: string | undefined;

afterAll(async () => {
  await server?.stop(true);
  clearTasks();
  resetStartupMilestones();
  mochiEvents.all.clear();
  if (outDir) {
    rmSync(outDir, { recursive: true, force: true });
  }
});

describe('the image janitor as a scheduled task', () => {
  test('registers itself, sweeps at boot, and never opens a lease store', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-image-sweep-'));
    const sweeps: MochiImageCacheSweepEvent[] = [];
    const elections: MochiTaskLeaderEvent[] = [];
    mochiEvents.on('image:cache-sweep', (e) => sweeps.push(e));
    mochiEvents.on('task:leader', (e) => elections.push(e));

    server = await Mochi.serve({
      port: 0,
      // Production mode, so `scheduler.leader` defaults to true — where an unnecessary election would bite.
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {},
      // A pattern that won't fire during the test, so any sweep we observe came from `runOnStart`.
      image: { sweepCron: '0 0 1 1 *' },
      // No jitter, so an election would resolve inside this test rather than up to
      // 30s later — without it the assertions pass whether or not the gate works.
      scheduler: { startupJitter: 0 },
    });

    const sweep = Mochi.getTask('mochi:image-sweep');
    expect(sweep.scope).toBe('node');
    expect(sweep.isScheduled()).toBe(true);

    // runOnStart reaches the real serve path.
    while (sweeps.length === 0) {
      await Bun.sleep(10);
    }
    expect(sweeps[0]!.durationMs).toBeGreaterThanOrEqual(0);

    // The janitor is node-scoped, so without the hasClusterTasks() gate every
    // image-enabled app would contend for a lease to coordinate per-process work.
    await Bun.sleep(150); // ample for a zero-jitter election to have landed
    expect(elections).toHaveLength(0);

    // And with nothing to coordinate, it must not touch the filesystem for a lease at all.
    for (const suffix of ['', '-wal', '-shm']) {
      expect(existsSync(path.join(outDir, `tasks.sqlite${suffix}`))).toBe(false);
    }
  }, 10_000);

  test('an app cannot shadow it with a task of the same name', () => {
    expect(() => Mochi.task('mochi:image-sweep', { cron: '* * * * *', run: () => {} })).toThrow(/reserved/);
  });
});
