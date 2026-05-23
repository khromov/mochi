import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { preprocessHydratable, PREPROCESS_LOGIC_VERSION, type PreprocessResult } from './svelteAstPreprocess';

const memCache: Map<string, PreprocessResult> = new Map();

/**
 * Cache key spans three invalidation axes:
 *   1. source content       — edits to the .svelte file
 *   2. file path            — `preprocessHydratable` resolves child imports
 *                             relative to filePath, so the same source at a
 *                             different path produces a different result
 *   3. preprocessor logic   — PREPROCESS_LOGIC_VERSION hashes
 *                             svelteAstPreprocess.ts itself
 *
 * Any change in any axis flips the key, so the cache cannot serve stale
 * output in dev.
 */
function cacheKey(source: string, filePath: string): string {
  return createHash('sha256').update(source).update('\0').update(filePath).update('\0').update(PREPROCESS_LOGIC_VERSION).digest('hex');
}

export function cachedPreprocessHydratable(source: string, filePath: string, cacheDir: string): PreprocessResult {
  const key = cacheKey(source, filePath);

  const fromMem = memCache.get(key);
  if (fromMem) {
    return fromMem;
  }

  const diskPath = path.join(cacheDir, `${key}.json`);
  try {
    const raw = readFileSync(diskPath, 'utf8');
    const parsed = JSON.parse(raw) as PreprocessResult;
    memCache.set(key, parsed);
    return parsed;
  } catch {
    // miss or corrupt — fall through to fresh preprocess
  }

  const result = preprocessHydratable(source, filePath);
  memCache.set(key, result);
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(diskPath, JSON.stringify(result));
  } catch {
    // disk cache is a perf optimization, not correctness — swallow write errors
  }
  return result;
}

/** Test-only: drop the in-memory cache. Disk cache is unaffected. */
export function __resetPreprocessMemCache(): void {
  memCache.clear();
}
