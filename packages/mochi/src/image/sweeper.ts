import { mochiEvents } from '../events';
import { logger } from '../utils/log';
import type { ImageCache } from './imageCache';

/**
 * Start the periodic image-cache janitor. Runs `cache.sweep()` every
 * `intervalMs` — plus once shortly after boot so accrued cruft is reclaimed and
 * the result is visible right away — emitting an `image:cache-sweep` event per
 * run. The timers are `unref`'d, so the sweeper never keeps the process alive.
 * A non-positive interval disables it (returns a no-op). Returns a stop function.
 */
export function startImageCacheSweeper(cache: ImageCache, intervalMs: number): () => void {
  if (!(intervalMs > 0)) {
    return () => {};
  }

  const runSweep = async (): Promise<void> => {
    const start = Date.now();
    try {
      const { removedVariants, removedOriginals, freedBytes } = await cache.sweep(start);
      mochiEvents.emit('image:cache-sweep', { removedVariants, removedOriginals, freedBytes, durationMs: Date.now() - start });
    } catch (err) {
      logger.warn(`Image cache sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const initial = setTimeout(runSweep, 1_000);
  const interval = setInterval(runSweep, intervalMs);
  initial.unref?.();
  interval.unref?.();

  return () => {
    clearTimeout(initial);
    clearInterval(interval);
  };
}
