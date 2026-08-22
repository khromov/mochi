import type { MochiWarmupOptions } from '../types';

// Warmup requests are tagged by object identity: a header would be forgeable by real clients, whose traffic would then
// be mislabelled as warmup, and real and warmup traffic share one page handler with no choke point to strip it. A
// network request can never be in this set.
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

/** Whether a route pattern can be warmed. Only fully static patterns qualify, since `:param` segments and `*` catch-alls have no single canonical URL. */
export function isWarmablePattern(pattern: string): boolean {
  return !pattern.includes(':') && !pattern.includes('*');
}

/**
 * Resolve whether route warmup runs for the current mode. Boolean `true` warms in production only, since dev restarts
 * are frequent and the extra render burst isn't worth it; the object form gives explicit per-mode control.
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
