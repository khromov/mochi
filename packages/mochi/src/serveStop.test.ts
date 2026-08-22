import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { getBoss } from './queue';
import { mochiEvents } from './events';
import type { MochiServerStopEvent } from './events';
import { reachedStartupMilestones } from './lifecycle';

describe('Mochi.stop()', () => {
  let outDir: string;

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('stops the server and queue runtime without exiting the process', async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-stop-'));
    const stopEvents: MochiServerStopEvent[] = [];
    const hookSignals: Array<unknown> = [];
    mochiEvents.on('server:stop', (e) => stopEvents.push(e));

    const jobs = Mochi.queue<{ n: number }>('stop-jobs', { process: async () => null });
    const server: Server<undefined> = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {},
      queueStorage: { sqlite: path.join(outDir, 'queue.sqlite') },
      queues: [jobs],
      shutdownTimeout: 0,
      eventHooks: {
        'mochi:shutdown': ({ signal }) => {
          hookSignals.push(signal);
        },
      },
    });
    const url = `http://localhost:${server.port}/`;
    expect((await fetch(url)).status).toBeGreaterThan(0);
    expect(typeof getBoss().send).toBe('function');

    await Mochi.stop();

    // The hook saw a programmatic stop (no signal), the event says 'stop', and everything is torn down.
    expect(hookSignals).toEqual([undefined]);
    expect(stopEvents).toEqual([{ reason: 'stop' }]);
    expect(() => getBoss()).toThrow(/queue runtime is not running/);
    expect(reachedStartupMilestones()).toEqual([]);
    expect(fetch(url)).rejects.toThrow();

    // Idempotent: a second stop resolves without re-firing the hook or the event.
    await expect(Mochi.stop()).resolves.toBeUndefined();
    expect(hookSignals).toHaveLength(1);
    expect(stopEvents).toHaveLength(1);
  }, 15_000);
});
