import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { isMochiQueue } from './types';
import { closeAllQueueResources } from './queue';
import { logger } from './utils/log';
import { reachedStartupMilestones, resetStartupMilestones } from './lifecycle';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Mochi.queue descriptor', () => {
  test('returns a named, inert descriptor and does not start a queue runtime', () => {
    const process = async (): Promise<{ ok: true }> => ({ ok: true });
    const config = Mochi.queue('emails', { process, concurrency: 3 });
    expect(isMochiQueue(config)).toBe(true);
    expect(config.name).toBe('emails');
    expect(config.process).toBe(process);
    expect(config.options).toEqual({ concurrency: 3 });
    expect(config.on).toBeUndefined();
    // The descriptor is directly usable as a producer handle, but declaring it must not boot anything.
    expect(typeof config.add).toBe('function');
    expect(() => Mochi.boss()).toThrow(/queue runtime is not running/);
  });

  test('splits `process`, `on`, and `storage` out of the runtime options', () => {
    const completed = (): void => {};
    const config = Mochi.queue('split', { process: async () => null, concurrency: 1, retryLimit: 4, on: { completed }, storage: 'memory' });
    // Anything left in `options` becomes bun-boss queue/worker configuration, so none of these may leak through.
    expect(config.options).toEqual({ concurrency: 1, retryLimit: 4 });
    expect(config.on?.completed).toBe(completed);
    expect(config.storage).toBe('memory');
  });

  test('a processor-less descriptor is valid', () => {
    const config = Mochi.queue('holding-pen', { deadLetter: 'other' });
    expect(isMochiQueue(config)).toBe(true);
    expect(config.process).toBeUndefined();
    expect(config.options).toEqual({ deadLetter: 'other' });
  });

  test('rejects an invalid name or batchSize at declaration', () => {
    expect(() => Mochi.queue('bad name')).toThrow(/not a valid queue name/);
    expect(() => Mochi.queue('q', { batchSize: 0 })).toThrow(/batchSize/);
    expect(() => Mochi.queue('q', { batchSize: 1.5 })).toThrow(/batchSize/);
    expect(() => Mochi.queue('q', { storage: { sqlite: '' } as never })).toThrow(/storage/);
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

  test('rejects a deadLetter naming a queue outside the array before binding', async () => {
    expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        routes: {},
        queues: [Mochi.queue('orphan', { process: async () => null, deadLetter: 'not-declared' })],
      }),
    ).rejects.toThrow(/names "not-declared" as its deadLetter queue/);
  });

  test('rejects duplicate queue names before binding', async () => {
    expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        routes: {},
        queues: [Mochi.queue('dup', { process: async () => null }), Mochi.queue('dup')],
      }),
    ).rejects.toThrow(/two queues are named "dup"/);
  });

  test('rejects a hand-built descriptor with an invalid name before binding', async () => {
    // Mochi.queue() validates at declaration, so only a hand-built object can smuggle a bad name this far.
    expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        routes: {},
        queues: [{ __mochiQueue: true, name: 'bad name' } as never],
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
        queues: [Mochi.queue('q', { process: async () => null })],
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
        queues: [Mochi.queue('q', { process: async () => null })],
        queueStorage: { sqlite: 'queue.sqlite', postgres: 'postgres://localhost/db' },
      }),
    ).rejects.toThrow(/queueStorage/);
  });

  test('mounts queues on sqlite storage, processes via the descriptor handle, and warns when a descriptor storage loses to serve', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-queues-'));
    const sqliteFile = path.join(outDir, 'queue.sqlite');
    const processed: string[] = [];
    const completed = deferred<{ queue: string; result: unknown }>();

    const jobs = Mochi.queue<{ to: string }>('serve-queue-jobs', {
      pollingIntervalSeconds: 0.5,
      // Loses to the serve-level queueStorage below, which must produce a warning.
      storage: 'memory',
      process: async (job) => {
        processed.push(job.data.to);
        return { sent: true };
      },
      on: {
        completed: (job, result) => completed.resolve({ queue: job.queue, result }),
      },
    });

    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      server = await Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        outDir,
        routes: {},
        queueStorage: { sqlite: sqliteFile },
        queues: [jobs],
      });
      expect(warn.mock.calls.flat().some((m) => String(m).includes('the serve-level queueStorage wins'))).toBe(true);
    } finally {
      warn.mockRestore();
    }

    const jobId = await jobs.add({ to: 'alice' });
    expect(jobId).toBeString();

    const done = await completed.promise;
    expect(processed).toEqual(['alice']);
    expect(done.queue).toBe('serve-queue-jobs');
    expect(done.result).toEqual({ sent: true });
    expect(existsSync(sqliteFile)).toBe(true);
    // The name-based lookup resolves the same mounted queue.
    expect(Mochi.getQueue('serve-queue-jobs').name).toBe('serve-queue-jobs');
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
