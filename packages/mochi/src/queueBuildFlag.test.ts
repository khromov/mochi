import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Mochi } from './Mochi';
import { getBoss } from './queue';
import { markBuilding } from './utils/buildFlag';

// Dedicated file: markBuilding() is irreversible for the process, so no other queue test can share it.
const dataDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-queue-buildflag-'));

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('queues during a mochi-framework build', () => {
  test('adds are suppressed: no runtime boots, no storage is touched', async () => {
    markBuilding();
    const file = path.join(dataDir, 'never-created.sqlite');
    const q = Mochi.queue<{ n: number }>('build-q', { storage: { sqlite: file } });

    expect(await q.add({ n: 1 })).toBeNull();
    expect(await q.addBulk([{ data: { n: 2 } }])).toEqual([]);
    expect(await q.addThrottled({ n: 3 }, 60)).toBeNull();
    expect(await q.addDebounced({ n: 4 }, 60)).toBeNull();
    await q.stop();

    const worker = Mochi.worker({ queues: [q] });
    await worker.start();
    await worker.stop();

    expect(() => getBoss()).toThrow(/queue runtime is not running/);
    expect(existsSync(file)).toBe(false);
  });
});
