import { hasSubscribers, mochiEvents } from './events';
import { preprocessHydratable, type PreprocessResult } from './svelteAstPreprocess';

const memCache: Map<string, { source: string; result: PreprocessResult }> = new Map();

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
    if (stats) {stats.hits++;}
    if (hasSubscribers('preprocess-cache:hit')) {
      mochiEvents.emit('preprocess-cache:hit', { filePath });
    }
    return entry.result;
  }
  const result = preprocessHydratable(source, filePath);
  memCache.set(filePath, { source, result });
  if (stats) {stats.misses++;}
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
  return memCache.delete(filePath);
}

/** Test-only: drop the in-memory cache. */
export function __resetPreprocessMemCache(): void {
  memCache.clear();
}
