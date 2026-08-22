import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { registeredCronJobs, stopAllCronJobs } from './cron';
import { closeAllQueueResources } from './queue';
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
  stopAllCronJobs();
  await closeAllQueueResources();
  resetStartupMilestones();
  for (const dir of outDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const serve = async (cron: Parameters<typeof Mochi.serve>[0]['cron']): Promise<Server<undefined>> =>
  Mochi.serve({ port: 0, development: false, logger: { enabled: false }, routes: {}, outDir: makeOutDir(), cron });

// Only one Mochi.serve() may succeed per process (the __mochi_config__ singleton, which server.stop() never clears),
// so exactly one test here boots a server; the rest assert rejections, which throw in the prelude before it pins.
describe('Mochi.serve({ cron })', () => {
  test('starts declared jobs and stops them when the server stops', async () => {
    server = await serve([Mochi.cron('nightly', '0 3 * * *', () => {}), Mochi.cron('hourly', '@hourly', () => {})]);
    expect(registeredCronJobs().sort()).toEqual(['hourly', 'nightly']);

    await server.stop(true);
    server = undefined;
    expect(registeredCronJobs()).toEqual([]);
  });

  // Rejecting before bind matters: the alternative is a listening server with half a schedule registered.
  test('rejects duplicate job names before binding', async () => {
    await expect(serve([Mochi.cron('dup', '@daily', () => {}), Mochi.cron('dup', '@hourly', () => {})])).rejects.toThrow(/two cron jobs are named "dup"/);
    expect(registeredCronJobs()).toEqual([]);
  });

  test('rejects anything that is not a Mochi.cron descriptor', async () => {
    await expect(serve([{ name: 'fake', schedule: '@daily' } as never])).rejects.toThrow(/must be a descriptor created with Mochi.cron/);
  });

  test('rejects an invalid job name that bypassed the factory', async () => {
    const smuggled = { ...Mochi.cron('ok', '@daily', () => {}), name: 'bad name' } as never;
    await expect(serve([smuggled])).rejects.toThrow(/is not a valid cron job name/);
  });

  test('the descriptor is recognised by isMochiCron', () => {
    expect(isMochiCron(Mochi.cron('x', '@daily', () => {}))).toBe(true);
    expect(isMochiCron({ name: 'x' })).toBe(false);
  });
});
