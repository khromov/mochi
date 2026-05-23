import { mochiEvents } from './events';
import { preprocessHydratable, type PreprocessResult } from './svelteAstPreprocess';

const memCache: Map<string, { source: string; result: PreprocessResult }> = new Map();

let hits = 0;
let misses = 0;

export function cachedPreprocessHydratable(source: string, filePath: string): PreprocessResult {
  const entry = memCache.get(filePath);
  // String `===` is a value compare, so any byte change in the source invalidates the entry.
  if (entry && entry.source === source) {
    hits++;
    mochiEvents.emit('preprocess-cache:hit', { filePath });
    return entry.result;
  }
  const result = preprocessHydratable(source, filePath);
  memCache.set(filePath, { source, result });
  misses++;
  mochiEvents.emit('preprocess-cache:miss', { filePath });
  return result;
}

/**
 * Read the current cache stats and reset the counters. The `compileAll`
 * orchestrator calls this once per batch and forwards the values as a
 * `preprocess-cache:summary` event payload.
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
