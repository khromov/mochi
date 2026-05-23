import { hasSubscribers, mochiEvents } from './events';
import { preprocessHydratable, type PreprocessResult } from './svelteAstPreprocess';

const memCache: Map<string, { source: string; result: PreprocessResult }> = new Map();

let hits = 0;
let misses = 0;

export function cachedPreprocessHydratable(source: string, filePath: string): PreprocessResult {
  const entry = memCache.get(filePath);
  if (entry && entry.source === source) {
    hits++;
    if (hasSubscribers('preprocess-cache:hit')) {
      mochiEvents.emit('preprocess-cache:hit', { filePath });
    }
    return entry.result;
  }
  const result = preprocessHydratable(source, filePath);
  memCache.set(filePath, { source, result });
  misses++;
  if (hasSubscribers('preprocess-cache:miss')) {
    mochiEvents.emit('preprocess-cache:miss', { filePath });
  }
  return result;
}

/**
 * Read the current cache stats and reset the counters. Caller (the
 * `compileAll` orchestrator) emits a `preprocess-cache:summary` event with
 * the returned values when there are subscribers for it.
 */
export function consumePreprocessCacheStats(): { hits: number; misses: number } {
  const stats = { hits, misses };
  hits = 0;
  misses = 0;
  return stats;
}

/** Test-only: drop the in-memory cache and reset stats. */
export function __resetPreprocessMemCache(): void {
  memCache.clear();
  hits = 0;
  misses = 0;
}
