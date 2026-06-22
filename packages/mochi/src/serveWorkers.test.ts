import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { isMochiWorker } from './types';
import { closeAllQueueResources, createWorker } from './queue';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Mochi.worker descriptor', () => {
  test('returns an inert config and does not start a worker', () => {
    const processor = async (): Promise<{ ok: true }> => ({ ok: true });
    const config = Mochi.worker(processor, { concurrency: 3 });
    expect(isMochiWorker(config)).toBe(true);
    expect(config.processor).toBe(processor);
    expect(config.options).toEqual({ concurrency: 3 });
    expect(config.on).toBeUndefined();
  });

  test('splits `on` listeners out of the worker options', () => {
    const completed = (): void => {};
    const config = Mochi.worker(async () => null, { concurrency: 1, on: { completed } });
    expect(config.options).toEqual({ concurrency: 1 });
    expect(config.on?.completed).toBe(completed);
  });
});

describe('Mochi.serve({ workers })', () => {
  let server: Server<undefined>;
  let outDir: string;

  afterAll(async () => {
    server?.stop(true);
    await closeAllQueueResources();
    rmSync(outDir, { recursive: true, force: true });
  });

  test('mounts a worker that processes jobs and fires config.on listeners', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-workers-'));
    const name = 'serve-worker-jobs';
    const processed: string[] = [];
    const completed = deferred<{ jobName: string; result: unknown }>();

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {},
      workers: {
        [name]: Mochi.worker<{ to: string }>(
          async (job) => {
            processed.push(job.data.to);
            return { sent: true };
          },
          {
            on: {
              completed: (job, result) => completed.resolve({ jobName: job.name, result }),
            },
          },
        ),
      },
    });

    const queue = Mochi.queue<{ to: string }>(name);
    await queue.add('notify', { to: 'alice' });

    const done = await completed.promise;
    expect(processed).toEqual(['alice']);
    expect(done.jobName).toBe('notify');
    expect(done.result).toEqual({ sent: true });
  });

  test('creating a worker after serve() has started is fatal (no dynamic insertion)', () => {
    // Runs after the serve above, which locked worker creation.
    expect(() => createWorker('too-late', async () => null)).toThrow(/no dynamic worker insertion/);
  });
});
