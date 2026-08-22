import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { closeAllQueueResources, registeredCronNames } from './queue';
import { resetStartupMilestones } from './lifecycle';
import { isMochiCron } from './types';

// An outDir must live inside the project tree — see CLAUDE.md; this file sits at src/, so one level up.
const outDirs: string[] = [];
const makeOutDir = (): string => {
  const dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-cron-'));
  outDirs.push(dir);
  return dir;
};

let server: Server<undefined> | undefined;

afterEach(async () => {
  server?.stop(true);
  server = undefined;
  await closeAllQueueResources();
  resetStartupMilestones();
  for (const dir of outDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A schedule far from now, so a real firing never races the test — registration is what's asserted here (firing is
// covered end-to-end in cronRuntime.test.ts with a fast monitor interval).
const IDLE = '0 0 1 1 *';

const serve = async (opts: Partial<Parameters<typeof Mochi.serve>[0]>): Promise<Server<undefined>> =>
  Mochi.serve({ port: 0, development: false, logger: { enabled: false }, routes: {}, outDir: makeOutDir(), ...opts });

describe('Mochi.serve({ cron })', () => {
  // Only one Mochi.serve() may succeed per process (the __mochi_config__ singleton), so exactly one test boots a
  // server; the rest assert rejections, which throw in the prelude before the singleton pins.
  test('starts durable schedules on the shared queue store and stops them on shutdown', async () => {
    server = await serve({ cron: [Mochi.cron('nightly', IDLE, () => {}), Mochi.cron('weekly', IDLE, () => {})] });
    expect((await registeredCronNames()).sort()).toEqual(['nightly', 'weekly']);

    await closeAllQueueResources();
    expect(await registeredCronNames()).toEqual([]);
  });

  test('rejects duplicate job names before binding', async () => {
    await expect(serve({ cron: [Mochi.cron('dup', IDLE, () => {}), Mochi.cron('dup', '@hourly', () => {})] })).rejects.toThrow(/two cron jobs are named "dup"/);
    expect(await registeredCronNames()).toEqual([]);
  });

  test('rejects a cron job whose name collides with a queue', async () => {
    await expect(
      serve({
        queues: [Mochi.queue('reports', { process: async () => null })],
        cron: [Mochi.cron('reports', IDLE, () => {})],
      }),
    ).rejects.toThrow(/both a cron job and a queue/);
  });

  test('rejects anything that is not a Mochi.cron descriptor', async () => {
    await expect(serve({ cron: [{ name: 'fake', schedule: IDLE } as never] })).rejects.toThrow(/must be a descriptor created with Mochi.cron/);
  });

  test('rejects an invalid cronStorage', async () => {
    await expect(serve({ cron: [Mochi.cron('x', IDLE, () => {})], cronStorage: { sqlite: '' } as never })).rejects.toThrow(/expected 'memory'/);
  });

  test('rejects a negative cronJitterSeconds', async () => {
    await expect(serve({ cron: [Mochi.cron('x', IDLE, () => {})], cronJitterSeconds: -1 })).rejects.toThrow(/non-negative number/);
  });

  test('the descriptor is recognised by isMochiCron', () => {
    expect(isMochiCron(Mochi.cron('x', IDLE, () => {}))).toBe(true);
    expect(isMochiCron({ name: 'x' })).toBe(false);
  });
});
