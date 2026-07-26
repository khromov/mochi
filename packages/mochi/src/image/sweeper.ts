import { mochiEvents } from '../events';
import type { ImageCache } from './imageCache';

/** The framework's own janitor task. Reserved name — an app cannot declare it. */
export const IMAGE_SWEEP_TASK = 'mochi:image-sweep';

/**
 * One janitor pass: reclaim entries past the cache window and report what went.
 *
 * Deliberately has no try/catch. It runs as a `Mochi.task()`, and the task runner
 * already logs the failure, emits `task:error`, and contains the throw — catching
 * here would only downgrade a visible failure to a swallowed warning.
 */
export async function runImageCacheSweep(cache: ImageCache): Promise<void> {
  const start = Date.now();
  const { removedVariants, removedOriginals, removedOther } = await cache.sweep(start);
  mochiEvents.emit('image:cache-sweep', { removedVariants, removedOriginals, removedOther, durationMs: Date.now() - start });
}
