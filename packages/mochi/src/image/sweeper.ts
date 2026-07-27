import { mochiEvents } from '../events';
import type { ImageCache } from './imageCache';

/** The framework's own janitor task. Reserved name — an app cannot declare it. */
export const IMAGE_SWEEP_TASK = 'mochi:image-sweep';

/** Deliberately has no try/catch: the task runner already logs, emits `task:error`, and contains the throw, so catching here would only hide a visible failure. */
export async function runImageCacheSweep(cache: ImageCache): Promise<void> {
  const start = Date.now();
  const { removedVariants, removedOriginals, removedOther } = await cache.sweep(start);
  mochiEvents.emit('image:cache-sweep', { removedVariants, removedOriginals, removedOther, durationMs: Date.now() - start });
}
