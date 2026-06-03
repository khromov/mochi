import { describe, expect, test } from 'bun:test';
import { startImageCacheSweeper } from './sweeper';
import type { ImageCache } from './imageCache';

function fakeCache(onSweep: () => void): ImageCache {
  return {
    sweep: async () => {
      onSweep();
      return { removedVariants: 0, removedOriginals: 0, freedBytes: 0 };
    },
  } as unknown as ImageCache;
}

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
});
