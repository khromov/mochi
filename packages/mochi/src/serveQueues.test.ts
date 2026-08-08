import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

  test('splits `process` and `on` out of the runtime options', () => {
    const completed = (): void => {};
    const config = Mochi.queue({ process: async () => null, concurrency: 1, retryLimit: 4, on: { completed } });
    // Anything left in `options` becomes bun-boss queue/worker configuration, so neither callback may leak through.
    expect(config.options).toEqual({ concurrency: 1, retryLimit: 4 });
    expect(config.on?.completed).toBe(completed);
  });

  test('a processor-less descriptor is valid', () => {
    const config = Mochi.queue({ deadLetter: 'other' });
    expect(isMochiQueue(config)).toBe(true);
    expect(config.process).toBeUndefined();
    expect(config.options).toEqual({ deadLetter: 'other' });
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

  test('rejects a deadLetter naming a queue outside the map before binding', async () => {
    expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        routes: {},
        queues: { orphan: Mochi.queue({ process: async () => null, deadLetter: 'not-declared' }) },
      }),
    ).rejects.toThrow(/names "not-declared" as its deadLetter queue/);
  });

  test('rejects an invalid queue name before binding', async () => {
    expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        routes: {},
        queues: { 'bad name': Mochi.queue({ process: async () => null }) },
      }),
    ).rejects.toThrow(/not a valid queue name/);
  });

  test('rejects a malformed queueStorage before binding', async () => {
    expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        routes: {},
        queues: { q: Mochi.queue({ process: async () => null }) },
        queueStorage: { sqlite: '' },
      }),
    ).rejects.toThrow(/queueStorage/);
  });

  test('rejects a queueStorage naming both backends before binding', async () => {
    expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        routes: {},
        queues: { q: Mochi.queue({ process: async () => null }) },
        queueStorage: { sqlite: 'queue.sqlite', postgres: 'postgres://localhost/db' },
      }),
    ).rejects.toThrow(/queueStorage/);
  });

  test('mounts a queue on sqlite storage that processes jobs and fires config.on listeners', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-queues-'));
    const sqliteFile = path.join(outDir, 'queue.sqlite');
    const name = 'serve-queue-jobs';
    const processed: string[] = [];
    const completed = deferred<{ queue: string; result: unknown }>();

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {},
      queueStorage: { sqlite: sqliteFile },
      queues: {
        [name]: Mochi.queue<{ to: string }>({
          pollingIntervalSeconds: 0.5,
          process: async (job) => {
            processed.push(job.data.to);
            return { sent: true };
          },
          on: {
            completed: (job, result) => completed.resolve({ queue: job.queue, result }),
          },
        }),
      },
    });

    const jobId = await Mochi.getQueue<{ to: string }>(name).add({ to: 'alice' });
    expect(jobId).toBeString();

    const done = await completed.promise;
    expect(processed).toEqual(['alice']);
    expect(done.queue).toBe(name);
    expect(done.result).toEqual({ sent: true });
    expect(existsSync(sqliteFile)).toBe(true);
  });

  test('Mochi.boss() resolves the shared bun-boss instance once queues are mounted', () => {
    expect(typeof Mochi.boss().send).toBe('function');
  });

  test('getQueue() for a name never declared in serve is fatal', () => {
    // serve() reached the mount milestone, so this is reported as a wrong name rather than as "too early",
    // and the error lists what is actually mounted.
    expect(() => Mochi.getQueue('never-declared')).toThrow(/no such queue/);
    expect(() => Mochi.getQueue('never-declared')).toThrow(/Mounted queues: serve-queue-jobs/);
  });

  test('serve records the startup milestones it passed', () => {
    expect(reachedStartupMilestones()).toEqual(['mochi:init', 'mochi:listening', 'mochi:queuesMounted', 'mochi:ready']);
  });
});
