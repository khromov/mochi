import type { MochiWarmupOptions } from './types';

// Warmup requests are tagged by object identity, not a header — a header would
// be forgeable by real clients (who'd then get their traffic mislabelled as
// warmup), and there's no choke point to strip it since real and warmup traffic
// share the same page handler. A network request can never be in this set.
const warmupRequests = new WeakSet<Request>();

/** Tag a synthetic warmup request so its `request` event is flagged as warmup. */
export function markWarmupRequest(req: Request): Request {
  warmupRequests.add(req);
  return req;
}

/** Whether `req` was issued by route warmup (vs. a real client). */
export function isWarmupRequest(req: Request): boolean {
  return warmupRequests.has(req);
}

/**
 * Whether a route pattern can be warmed. Only fully static patterns qualify:
 * `:param` segments and `*` catch-alls have no single canonical URL to warm,
 * so they're skipped.
 */
export function isWarmablePattern(pattern: string): boolean {
  return !pattern.includes(':') && !pattern.includes('*');
}

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
