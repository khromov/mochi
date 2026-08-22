import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createCronJob } from './cron';
import { closeAllQueueResources, registeredCronNames, startCronRuntime } from './queue';
import { mochiEvents } from './events';

// A dedicated cron boss on :memory: sqlite; a low monitor interval makes a `* * * * *` schedule fire within seconds,
// because bun-boss fires when the previous occurrence is under a minute old.
const runtimeOpts = { development: false, jitterMs: 0, cronMonitorIntervalSeconds: 1, cronWorkerIntervalSeconds: 1, workerPollingSeconds: 1 };

const tmpDirs: string[] = [];
const tmpSqlite = (): { sqlite: string } => {
  const dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-cronrt-'));
  tmpDirs.push(dir);
  return { sqlite: path.join(dir, 'cron.sqlite') };
};

afterEach(async () => {
  await closeAllQueueResources();
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const waitFor = async (predicate: () => boolean, timeoutMs = 20_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await Bun.sleep(200);
  }
  return predicate();
};

describe('startCronRuntime', () => {
  test('registers a schedule and runs its handler on the schedule', async () => {
    let runs = 0;
    const scheduled: string[] = [];
    const onScheduled = ({ job }: { job: string }) => scheduled.push(job);
    mochiEvents.on('cron:scheduled', onScheduled);

    try {
      await startCronRuntime([createCronJob('tick', '* * * * *', () => void runs++)], { ...runtimeOpts, cronStorage: 'memory' });
      expect(scheduled).toEqual(['tick']);
      expect(await registeredCronNames()).toEqual(['tick']);
      expect(await waitFor(() => runs > 0)).toBe(true);
    } finally {
      mochiEvents.off('cron:scheduled', onScheduled);
    }
  });

  // A durable cron run is a queue job, so a throw surfaces as queue:failed on the cron's name, not as a crash.
  test('a throwing handler surfaces as queue:failed and never takes the process down', async () => {
    const failures: { queue: string; error: string }[] = [];
    const rejections: unknown[] = [];
    const onFailed = (p: { queue: string; error: string }) => failures.push(p);
    const onRejection = (reason: unknown) => rejections.push(reason);
    mochiEvents.on('queue:failed', onFailed);
    process.on('unhandledRejection', onRejection);

    try {
      await startCronRuntime(
        [
          createCronJob('boom', '* * * * *', () => {
            throw new Error('cron handler exploded');
          }),
        ],
        { ...runtimeOpts, cronStorage: 'memory' },
      );
      expect(await waitFor(() => failures.length > 0)).toBe(true);
      expect(failures[0]!.queue).toBe('cron-boom'); // durable cron runs as a queue named cron-<name>
      expect(failures[0]!.error).toBe('cron handler exploded');
      expect(rejections).toEqual([]);
    } finally {
      mochiEvents.off('queue:failed', onFailed);
      process.off('unhandledRejection', onRejection);
    }
  });

  test('skips a job marked dev:false when development is on', async () => {
    await startCronRuntime([createCronJob('prod-only', '0 3 * * *', { run: () => {}, dev: false })], { cronStorage: 'memory', development: true, jitterMs: 0 });
    expect(await registeredCronNames()).toEqual([]);
  });

  // The dev watcher re-runs startCronRuntime on a cron edit without a close in between; it must replace the prior set.
  test('re-running replaces the previous set in place', async () => {
    await startCronRuntime([createCronJob('a', '0 3 * * *', () => {}), createCronJob('b', '0 4 * * *', () => {})], { cronStorage: 'memory', development: false, jitterMs: 0 });
    expect((await registeredCronNames()).sort()).toEqual(['a', 'b']);

    await startCronRuntime([createCronJob('a', '0 3 * * *', () => {}), createCronJob('c', '0 5 * * *', () => {})], { cronStorage: 'memory', development: false, jitterMs: 0 });
    expect((await registeredCronNames()).sort()).toEqual(['a', 'c']);
  });

  // Removing a Mochi.cron line must not leave an orphan schedule enqueuing jobs no worker consumes.
  test('reconcile drops a schedule that is no longer declared on the next boot', async () => {
    const storage = tmpSqlite();
    await startCronRuntime([createCronJob('keep', '0 3 * * *', () => {}), createCronJob('drop', '0 4 * * *', () => {})], {
      cronStorage: storage,
      development: false,
      jitterMs: 0,
    });
    expect((await registeredCronNames()).sort()).toEqual(['drop', 'keep']);
    await closeAllQueueResources();

    await startCronRuntime([createCronJob('keep', '0 3 * * *', () => {})], { cronStorage: storage, development: false, jitterMs: 0 });
    expect(await registeredCronNames()).toEqual(['keep']);
  });
});
