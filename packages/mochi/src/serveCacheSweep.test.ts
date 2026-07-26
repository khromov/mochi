import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { FileStorage } from './cache/cache-storage';
import { mochiEvents } from './events';
import type { MochiCacheSweepEvent } from './events';
import { clearTasks } from './tasks/tasks';
import { resetStartupMilestones } from './lifecycle';

// One Mochi.serve() per file — see serveTasks.test.ts for why.
let server: Server<undefined> | undefined;
let outDir: string | undefined;
const storages: FileStorage[] = [];

afterAll(async () => {
  await server?.stop(true);
  clearTasks();
  resetStartupMilestones();
  mochiEvents.all.clear();
  for (const storage of storages) {
    storage.dispose();
  }
  if (outDir) {
    rmSync(outDir, { recursive: true, force: true });
  }
});

describe('the cache janitor as a scheduled task', () => {
  test('one node-scoped task sweeps every storage in the process', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-cache-sweep-'));
    const sweeps: MochiCacheSweepEvent[] = [];
    mochiEvents.on('cache:sweep', (e) => sweeps.push(e));

    // Two storages sharing the registry — the point of the shared janitor is that this costs one timer, not two.
    for (const name of ['a', 'b']) {
      const storage = new FileStorage({ directory: path.join(outDir, `cache-${name}`), maxAge: 1 });
      storages.push(storage);
      await storage.setItem(name, { value: name });
    }

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {},
      // A pattern that won't fire during the test, so any sweep we observe came from `runOnStart`.
      cache: { sweepCron: '0 0 1 1 *' },
      scheduler: { startupJitter: 0 },
    });

    const sweep = Mochi.getTask('mochi:cache-sweep');
    expect(sweep.scope).toBe('node');
    expect(sweep.isScheduled()).toBe(true);

    // One runOnStart pass, one `cache:sweep` per registered storage.
    while (sweeps.length < 2) {
      await Bun.sleep(10);
    }
    expect(sweeps).toHaveLength(2);
    expect(await storages[0]!.getItem('a')).toBeNull();
    expect(await storages[1]!.getItem('b')).toBeNull();
  }, 10_000);

  test('a storage built after boot is picked up by the running task', async () => {
    const late = new FileStorage({ directory: path.join(outDir!, 'cache-late'), maxAge: 1 });
    storages.push(late);
    await late.setItem('late', { value: 1 });
    await Bun.sleep(5);

    await Mochi.getTask('mochi:cache-sweep').trigger();

    expect(await late.getItem('late')).toBeNull();
  });

  test('a purge: false storage sits the sweep out', async () => {
    const opted = new FileStorage({ directory: path.join(outDir!, 'cache-opted-out'), maxAge: 1, purge: false });
    storages.push(opted);
    await opted.setItem('kept', { value: 1 });
    await Bun.sleep(5);

    await Mochi.getTask('mochi:cache-sweep').trigger();

    expect(await opted.getItem('kept')).not.toBeNull();
  });

  test('an app cannot shadow it with a task of the same name', () => {
    expect(() => Mochi.task('mochi:cache-sweep', { cron: '* * * * *', run: () => {} })).toThrow(/reserved/);
  });
});
