import { afterEach, describe, expect, test } from 'bun:test';
import { mochiEvents } from '../events';
import type { MochiImageCacheSweepEvent } from '../events';
import { startImageCacheSweeper } from './sweeper';
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

describe('startImageCacheSweeper', () => {
  test('a non-positive interval is a disabled no-op', () => {
    let swept = 0;
    startImageCacheSweeper(
      fakeCache(() => swept++),
      0,
    )();
    expect(swept).toBe(0);
  });

  test('runs a sweep shortly after start', async () => {
    let swept = 0;
    const stop = startImageCacheSweeper(
      fakeCache(() => swept++),
      3_600_000,
    );
    await new Promise((r) => setTimeout(r, 1200));
    stop();
    expect(swept).toBeGreaterThanOrEqual(1);
  });

  test('stop() clears the timers so no sweep runs afterwards', async () => {
    let swept = 0;
    const stop = startImageCacheSweeper(
      fakeCache(() => swept++),
      3_600_000,
    );
    stop(); // before the ~1s post-boot sweep fires
    await new Promise((r) => setTimeout(r, 1200));
    expect(swept).toBe(0);
  });

  test('emits image:cache-sweep carrying the cache’s counts', async () => {
    const events: MochiImageCacheSweepEvent[] = [];
    mochiEvents.on('image:cache-sweep', (e) => events.push(e));

    const stop = startImageCacheSweeper(
      fakeCache(() => {}, { removedVariants: 3, removedOriginals: 2, removedOther: 1 }),
      3_600_000,
    );
    await new Promise((r) => setTimeout(r, 1200));
    stop();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toMatchObject({ removedVariants: 3, removedOriginals: 2, removedOther: 1 });
    expect(typeof events[0]!.durationMs).toBe('number');
    expect(Number.isFinite(events[0]!.durationMs)).toBe(true);
  });
});
