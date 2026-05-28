import type { MochiWarmupOptions } from './types';

/**
 * Resolve whether route warmup should run for the current mode.
 *
 * Boolean `true` warms in production only — dev restarts are frequent and the
 * extra render burst isn't worth it. The object form gives explicit per-mode
 * control. `undefined`/`false` disable warmup entirely.
 */
export function resolveWarmupEnabled(warmup: boolean | MochiWarmupOptions | undefined, development: boolean): boolean {
  if (typeof warmup === 'boolean') {
    return warmup && !development;
  }
  if (warmup) {
    return development ? warmup.enabledInDev : warmup.enabledInProd;
  }
  return false;
}
