import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { isMochiTask } from './types';
import { clearTasks } from './tasks/tasks';
import { reachedStartupMilestones, resetStartupMilestones } from './lifecycle';

// One Mochi.serve() per file: the `__mochi_config__` singleton is never cleared by
// server.stop(), so a second boot in this process throws.
let server: Server<undefined> | undefined;
let outDir: string | undefined;

afterAll(async () => {
  await server?.stop(true);
  clearTasks();
  resetStartupMilestones();
  if (outDir) {
    rmSync(outDir, { recursive: true, force: true });
  }
});

describe('Mochi.task() descriptor', () => {
  test('the config form is inert and brands itself', () => {
    const config = Mochi.task({ cron: '* * * * *', run: () => {} });
    expect(isMochiTask(config)).toBe(true);
    expect(config.options.cron).toBe('* * * * *');
  });

  test('the named form registers and returns a live handle', () => {
    const handle = Mochi.task('inline', { cron: '0 0 1 1 *', run: () => {} });
    expect(handle.name).toBe('inline');
    // Registration alone must not arm a timer — the scheduler decides that.
    expect(handle.isScheduled()).toBe(false);
    expect(Mochi.getTask('inline')).toBe(handle);
  });
});

describe('Mochi.serve({ tasks })', () => {
  test('mounts declared tasks, records the milestone, and fires on schedule', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-tasks-'));
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
      tasks: {
        ticker: Mochi.task({ cron: '* * * * * *', run: () => resolveFired() }),
      },
      // Single-node mode: no lease store, every task runs here.
      scheduler: { leader: false },
    });

    expect(reachedStartupMilestones()).toContain('mochi:tasksMounted');
    expect(Mochi.getTask('ticker').isScheduled()).toBe(true);
    // Registered earlier in this file, so it survives into the mounted registry.
    expect(Mochi.getTask('inline').name).toBe('inline');

    await fired;
    expect(Mochi.getTask('ticker').previousRun()).toBeInstanceOf(Date);
  }, 10_000);
});
