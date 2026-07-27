import { afterEach, describe, expect, test } from 'bun:test';
import { mochiEvents } from '../events';
import type { MochiImageCacheSweepEvent } from '../events';
import { runImageCacheSweep } from './sweeper';
import type { ImageCache } from './imageCache';

function fakeCache(onSweep: () => void, result: Awaited<ReturnType<ImageCache['sweep']>> = { removedVariants: 0, removedOriginals: 0, removedOther: 0 }): ImageCache {
  return {
    sweep: async () => {
      onSweep();
      return result;
    },
  } as unknown as ImageCache;
}

afterEach(() => {
  mochiEvents.all.clear();
});

describe('runImageCacheSweep', () => {
  test('sweeps the cache and emits image:cache-sweep carrying its counts', async () => {
    const events: MochiImageCacheSweepEvent[] = [];
    mochiEvents.on('image:cache-sweep', (e) => events.push(e));

    let swept = 0;
    await runImageCacheSweep(fakeCache(() => swept++, { removedVariants: 3, removedOriginals: 2, removedOther: 1 }));

    expect(swept).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ removedVariants: 3, removedOriginals: 2, removedOther: 1 });
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('propagates a failing sweep instead of swallowing it', async () => {
    const cache = {
      sweep: async () => {
        throw new Error('disk on fire');
      },
    } as unknown as ImageCache;

    // The task runner owns error reporting (logs + `task:error`), so this must
    // reject rather than warn-and-continue the way the old timer did.
    await expect(runImageCacheSweep(cache)).rejects.toThrow('disk on fire');
  });

  test('emits nothing when the sweep fails', async () => {
    const events: MochiImageCacheSweepEvent[] = [];
    mochiEvents.on('image:cache-sweep', (e) => events.push(e));

    const cache = { sweep: async () => Promise.reject(new Error('nope')) } as unknown as ImageCache;
    await expect(runImageCacheSweep(cache)).rejects.toThrow('nope');
    expect(events).toHaveLength(0);
  });
});
