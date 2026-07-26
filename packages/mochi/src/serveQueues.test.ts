import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { isMochiQueue } from './types';
import { closeAllQueueResources } from './queue';
import { reachedStartupMilestones, resetStartupMilestones } from './lifecycle';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Mochi.queue descriptor', () => {
  test('returns an inert config and does not start a queue', () => {
    const process = async (): Promise<{ ok: true }> => ({ ok: true });
    const config = Mochi.queue({ process, concurrency: 3 });
    expect(isMochiQueue(config)).toBe(true);
    expect(config.process).toBe(process);
    expect(config.options).toEqual({ concurrency: 3 });
    expect(config.on).toBeUndefined();
  });

  test('splits `process`, `on` and `recover` out of the runtime options', () => {
    const completed = (): void => {};
    const recover = (): void => {};
    const config = Mochi.queue({ process: async () => null, concurrency: 1, on: { completed }, recover });
    // Anything left in `options` is forwarded verbatim to bunqueue, so these
    // three must not leak through.
    expect(config.options).toEqual({ concurrency: 1 });
    expect(config.on?.completed).toBe(completed);
    expect(config.recover).toBe(recover);
  });
});

describe('Mochi.serve({ queues })', () => {
  let server: Server<undefined>;
  let outDir: string;

  afterAll(async () => {
    server?.stop(true);
    await closeAllQueueResources();
    resetStartupMilestones();
    rmSync(outDir, { recursive: true, force: true });
  });

  test('mounts a queue that processes jobs and fires config.on listeners', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-queues-'));
    const name = 'serve-queue-jobs';
    const processed: string[] = [];
    const completed = deferred<{ jobName: string; result: unknown }>();

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {},
      queues: {
        [name]: Mochi.queue<{ to: string }>({
          process: async (job) => {
            processed.push(job.data.to);
            return { sent: true };
          },
          on: {
            completed: (job, result) => completed.resolve({ jobName: job.name, result }),
          },
        }),
      },
    });

    await Mochi.getQueue<{ to: string }>(name).add('notify', { to: 'alice' });

    const done = await completed.promise;
    expect(processed).toEqual(['alice']);
    expect(done.jobName).toBe('notify');
    expect(done.result).toEqual({ sent: true });
  });

  test('getQueue() for a name never declared in serve is fatal', () => {
    // serve() reached the mount milestone, so this is reported as a wrong name
    // rather than as "too early", and the error lists what is actually mounted.
    expect(() => Mochi.getQueue('never-declared')).toThrow(/no such queue/);
    expect(() => Mochi.getQueue('never-declared')).toThrow(/Mounted queues: serve-queue-jobs/);
  });

  test('serve records the startup milestones it passed', () => {
    // `mochi:tasksMounted` fires even with no tasks declared — the milestone marks
    // that the mounting step ran, which is what `getTask()` reads to tell "too
    // early" apart from "you declared none".
    expect(reachedStartupMilestones()).toEqual(['mochi:init', 'mochi:listening', 'mochi:queuesMounted', 'mochi:tasksMounted', 'mochi:ready']);
  });
});
