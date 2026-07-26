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
      // Production mode, so `scheduler.leader` defaults to true — the exact
      // configuration in which an unnecessary election would bite.
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {},
      // A pattern that won't fire during the test: any sweep we observe came from
      // `runOnStart`, not the schedule.
      image: { sweepCron: '0 0 1 1 *' },
      // No jitter, so an election — if one were started at all — would resolve
      // within this test rather than up to 30s later. Without that the assertions
      // below would pass whether or not the gate works.
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

    // The janitor is node-scoped, so there is nothing to elect a leader for.
    // Without the hasClusterTasks() gate every image-enabled app would contend
    // for a lease, heartbeat forever, and warn that its replicas will each elect
    // themselves — all to coordinate work that is per-process by definition.
    await Bun.sleep(150); // ample for a zero-jitter election to have landed
    expect(elections).toHaveLength(0);

    // Nothing here needs a lease: no cluster task to elect for, and no queue to
    // recover. An app in this shape must not touch the filesystem for one —
    // a read-only rootfs would turn "nothing to coordinate" into a boot crash.
    for (const suffix of ['', '-wal', '-shm']) {
      expect(existsSync(path.join(outDir, `tasks.sqlite${suffix}`))).toBe(false);
    }
  }, 10_000);

  test('an app cannot shadow it with a task of the same name', () => {
    expect(() => Mochi.task('mochi:image-sweep', { cron: '* * * * *', run: () => {} })).toThrow(/reserved/);
  });
});
