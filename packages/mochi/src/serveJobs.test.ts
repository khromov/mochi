import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { isMochiJobs, closeAllJobResources } from './jobs';
import { defineJobTypes } from 'queuert';
import { reachedStartupMilestones, resetStartupMilestones } from './lifecycle';

const jobs = Mochi.jobs({
  types: defineJobTypes<{
    notify: { entry: true; input: { to: string }; output: { sent: boolean } };
  }>(),
  processors: {
    notify: {
      attemptHandler: async ({ job, complete }) => {
        processed.push(job.input.to);
        return complete(async () => ({ sent: true }));
      },
    },
  },
});
const processed: string[] = [];

describe('Mochi.serve({ jobs })', () => {
  let server: Server<undefined>;
  let outDir: string;

  afterAll(async () => {
    server?.stop(true);
    await closeAllJobResources();
    resetStartupMilestones();
    rmSync(outDir, { recursive: true, force: true });
  });

  test('Mochi.jobs returns an inert descriptor without starting a worker', () => {
    expect(isMochiJobs(jobs)).toBe(true);
    // No runtime exists yet, so using the handle rejects instead of touching a live worker.
    expect(jobs.startChain({ typeName: 'notify', input: { to: 'x' } })).rejects.toThrow(/not mounted yet/);
  });

  test('mounts the jobs runtime and processes a chain end to end', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-jobs-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {},
      jobs,
    });

    const chain = await jobs.startChain({ typeName: 'notify', input: { to: 'alice' } });
    const done = await jobs.awaitChain({ id: chain.id }, { timeoutMs: 10_000 });
    expect(done.output).toEqual({ sent: true });
    expect(processed).toEqual(['alice']);
  });

  test('serve records the startup milestones it passed', () => {
    expect(reachedStartupMilestones()).toEqual(['mochi:init', 'mochi:listening', 'mochi:jobsMounted', 'mochi:ready']);
  });

  test('server.stop() tears the jobs runtime down with the server', async () => {
    await server.stop(true);
    // The runtime is gone; the milestone survives a bare stop() by design, so the error blames the missing runtime.
    await expect(jobs.startChain({ typeName: 'notify', input: { to: 'late' } })).rejects.toThrow(/without a `jobs` option/);
  });
});
