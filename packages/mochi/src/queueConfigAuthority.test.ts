import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Mochi } from './Mochi';
import { startQueueRuntime, mountQueues, getBoss, closeAllQueueResources, resolveQueueConfigMode } from './queue';
import { mochiEvents } from './events';
import { initExtensions } from './extensions';
import { resetStartupMilestones } from './lifecycle';
import { logger } from './utils/log';

const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-queue-authority-'));

afterEach(async () => {
  mochiEvents.all.clear();
  resetStartupMilestones();
  initExtensions({});
  await closeAllQueueResources();
});

afterAll(async () => {
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
});

describe('code-authoritative queue config', () => {
  test('an identical remount passes; a differing one throws naming the queue, fields, and both migration levers', async () => {
    const file = path.join(dataDir, 'mismatch.sqlite');
    await startQueueRuntime({ sqlite: file });
    await mountQueues([{ name: 'strict', options: { retryLimit: 3, retryDelay: 5 } }]);
    await closeAllQueueResources();

    await startQueueRuntime({ sqlite: file });
    await mountQueues([{ name: 'strict', options: { retryLimit: 3, retryDelay: 5 } }]);
    await closeAllQueueResources();

    await startQueueRuntime({ sqlite: file });
    let error: Error | undefined;
    await mountQueues([{ name: 'strict', options: { retryLimit: 5, retryDelay: 5 } }]).catch((err: Error) => (error = err));
    expect(error?.message).toContain('Mochi.serve({ queues }): "strict" already exists in storage with retryLimit 3, but this code declares retryLimit 5');
    expect(error?.message).toContain('Mochi.boss().updateQueue("strict", { retryLimit: 5 })');
    expect(error?.message).toContain("MOCHI_QUEUE_SYNC=1 (or queueConfig: 'sync')");
  }, 15_000);

  test('a boolean option does not read as drift on sqlite', async () => {
    const file = path.join(dataDir, 'boolean.sqlite');
    await startQueueRuntime({ sqlite: file });
    await mountQueues([{ name: 'backoff', options: { retryBackoff: true, retryDelay: 1 } }]);
    await closeAllQueueResources();

    await startQueueRuntime({ sqlite: file });
    await mountQueues([{ name: 'backoff', options: { retryBackoff: true, retryDelay: 1 } }]);
    expect((await getBoss().getQueue('backoff'))?.retryBackoff).toBeTruthy();
  }, 15_000);

  test('sync mode repairs drift and logs each field; the env var forces sync over the code option', async () => {
    const file = path.join(dataDir, 'sync.sqlite');
    await startQueueRuntime({ sqlite: file });
    await mountQueues([{ name: 'drifted', options: { retryLimit: 3 } }]);
    await closeAllQueueResources();

    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await startQueueRuntime({ sqlite: file });
      await mountQueues([{ name: 'drifted', options: { retryLimit: 9 } }], 'sync');
      expect((await getBoss().getQueue('drifted'))?.retryLimit).toBe(9);
      expect(warn.mock.calls.some((args) => String(args[0]).includes('"drifted": synced stored config to the declaration — retryLimit 3 → 9'))).toBe(true);
    } finally {
      warn.mockRestore();
    }

    process.env.MOCHI_QUEUE_SYNC = '1';
    try {
      expect(resolveQueueConfigMode('verify')).toBe('sync');
      expect(resolveQueueConfigMode()).toBe('sync');
    } finally {
      delete process.env.MOCHI_QUEUE_SYNC;
    }
    expect(resolveQueueConfigMode()).toBe('verify');
    expect(resolveQueueConfigMode('sync')).toBe('sync');
  }, 15_000);

  test('clearing a stored deadLetter cannot be synced: even sync mode throws, pointing at the reset recipe', async () => {
    const file = path.join(dataDir, 'clear.sqlite');
    await startQueueRuntime({ sqlite: file });
    await mountQueues([{ name: 'clear-dlq' }, { name: 'clear-work', options: { retryLimit: 0, deadLetter: 'clear-dlq' } }]);
    expect((await getBoss().getQueue('clear-work'))?.deadLetter).toBe('clear-dlq');
    await closeAllQueueResources();

    await startQueueRuntime({ sqlite: file });
    let error: Error | undefined;
    await mountQueues([{ name: 'clear-dlq' }, { name: 'clear-work', options: { retryLimit: 0 } }], 'sync').catch((err: Error) => (error = err));
    expect(error?.message).toContain('"clear-work" already exists in storage with deadLetter "clear-dlq", but this code declares deadLetter unset');
    expect(error?.message).toContain('deadLetter cannot be cleared');
    expect(error?.message).toContain('Mochi.boss().deleteQueue("clear-work")');
  }, 15_000);

  test('a deadLetter loop cannot be created from scratch, but an existing matching loop passes verification', async () => {
    const file = path.join(dataDir, 'loop.sqlite');
    const loop = () => [
      { name: 'loop-a', options: { deadLetter: 'loop-b' } },
      { name: 'loop-b', options: { deadLetter: 'loop-a' } },
    ];
    await startQueueRuntime({ sqlite: file });
    let error: Error | undefined;
    await mountQueues(loop()).catch((err: Error) => (error = err));
    expect(error?.message).toContain('deadLetter loop among "loop-a", "loop-b"');
    expect(error?.message).toContain('cannot be created from scratch');

    // Build the loop by hand, as the error suggests, and remount: matching storage passes.
    await getBoss().createQueue('loop-a');
    await getBoss().createQueue('loop-b', { deadLetter: 'loop-a' });
    await getBoss().updateQueue('loop-a', { deadLetter: 'loop-b' });
    await mountQueues(loop());
    expect((await getBoss().getQueue('loop-a'))?.deadLetter).toBe('loop-b');
    expect((await getBoss().getQueue('loop-b'))?.deadLetter).toBe('loop-a');
  }, 15_000);

  test('the same name declared directly and as a differing descriptor deadLetter is rejected', async () => {
    const file = path.join(dataDir, 'dup.sqlite');
    await startQueueRuntime({ sqlite: file });
    const target = Mochi.queue('dup-dlq', { retryLimit: 5 });
    let error: Error | undefined;
    await mountQueues([{ name: 'dup-dlq' }, { name: 'dup-work', options: { deadLetter: target } }]).catch((err: Error) => (error = err));
    expect(error?.message).toContain('"dup-dlq" is declared twice with different options');
    expect(error?.message).toContain('once directly and once as "dup-work"\'s deadLetter descriptor');
  }, 15_000);
});
