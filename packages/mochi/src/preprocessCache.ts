import { preprocessHydratable, type PreprocessResult } from './svelteAstPreprocess';

// Keyed by absolute file path. Each entry stores the source text it was
// computed from so we can detect edits on subsequent calls without hashing.
const memCache: Map<string, { source: string; result: PreprocessResult }> = new Map();

export function cachedPreprocessHydratable(source: string, filePath: string): PreprocessResult {
  const hit = memCache.get(filePath);
  if (hit && hit.source === source) {
    return hit.result;
  }
  const result = preprocessHydratable(source, filePath);
  memCache.set(filePath, { source, result });
  return result;
}

/** Test-only: drop the in-memory cache. */
export function __resetPreprocessMemCache(): void {
  memCache.clear();
}
