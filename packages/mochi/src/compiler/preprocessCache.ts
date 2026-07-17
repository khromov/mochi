import type { CompileOptions } from 'svelte/compiler';
import { hasSubscribers, mochiEvents } from '../events';
import { injectHydratableContextSeed, preprocessHydratable, type HydratableSeedResult, type PreprocessResult } from './svelteAstPreprocess';

const memCache: Map<string, { source: string; result: PreprocessResult }> = new Map();

/**
 * Memo for the context-seed pass, which does a full `svelte.parse` per input.
 * Keyed per (target, filePath) because the same file is seeded with different
 * input strings for the server and client compiles; single-entry-per-key with
 * `===` source compare mirrors `memCache` (bounded by file count, and a dev
 * watcher edit naturally replaces the entry). The resolved `runes` value is
 * part of the validity check since it changes which prologue is injected.
 */
const seedCache: Map<string, { source: string; runesKey: string; result: HydratableSeedResult }> = new Map();

export function cachedInjectHydratableContextSeed(source: string, filePath: string, target: 'server' | 'client', runesOption?: CompileOptions['runes']): HydratableSeedResult {
  const key = `${target}\u0000${filePath}`;
  const runesKey = String(typeof runesOption === 'function' ? runesOption({ filename: filePath }) : runesOption);
  const entry = seedCache.get(key);
  if (entry && entry.source === source && entry.runesKey === runesKey) {
    return entry.result;
  }
  const result = injectHydratableContextSeed(source, filePath, runesOption);
  seedCache.set(key, { source, runesKey, result });
  return result;
}

export interface PreprocessCacheStats {
  hits: number;
  misses: number;
}

export function createPreprocessCacheStats(): PreprocessCacheStats {
  return { hits: 0, misses: 0 };
}

export function cachedPreprocessHydratable(source: string, filePath: string, stats?: PreprocessCacheStats): PreprocessResult {
  const entry = memCache.get(filePath);
  // String `===` is a value compare, so any byte change in the source invalidates the entry.
  if (entry && entry.source === source) {
    if (stats) {
      stats.hits++;
    }
    if (hasSubscribers('preprocess-cache:hit')) {
      mochiEvents.emit('preprocess-cache:hit', { filePath });
    }
    return entry.result;
  }
  const result = preprocessHydratable(source, filePath);
  memCache.set(filePath, { source, result });
  if (stats) {
    stats.misses++;
  }
  if (hasSubscribers('preprocess-cache:miss')) {
    mochiEvents.emit('preprocess-cache:miss', { filePath });
  }
  return result;
}

/**
 * Drop the cached entry for `filePath`. Called by the dev watcher on `unlink`
 * so deleted files don't accumulate stale entries over a long dev session.
 */
export function evictPreprocessCacheEntry(filePath: string): boolean {
  seedCache.delete(`server\u0000${filePath}`);
  seedCache.delete(`client\u0000${filePath}`);
  return memCache.delete(filePath);
}

/** Test-only: drop the in-memory caches. */
export function __resetPreprocessMemCache(): void {
  memCache.clear();
  seedCache.clear();
}
