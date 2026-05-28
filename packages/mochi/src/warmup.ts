import type { MochiWarmupOptions } from './types';

/**
 * Header set on synthetic warmup requests so the page handler can tag the
 * emitted `request` event (and its log line) as warmup rather than real
 * traffic. Internal — stripped from nothing, never sent to clients.
 */
export const WARMUP_REQUEST_HEADER = 'x-mochi-warmup';

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
