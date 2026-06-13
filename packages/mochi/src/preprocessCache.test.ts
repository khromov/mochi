import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { __resetPreprocessMemCache, cachedPreprocessHydratable, createPreprocessCacheStats, evictPreprocessCacheEntry } from './preprocessCache';
import { mochiEvents } from './events';
import type { MochiEventMap } from './events';

const SCRIPT = (imports: string) => `<script>\n${imports}\n</script>\n`;
const ISLAND_SOURCE = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate />`;

beforeEach(() => {
  __resetPreprocessMemCache();
});

describe('cachedPreprocessHydratable', () => {
  test('repeated call with same source+path returns the same object reference', () => {
    const first = cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    const second = cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    // Identity check proves it came from the cache, not a re-run.
    expect(second).toBe(first);
    expect(first.hydratables).toHaveLength(1);
  });

  test('source change invalidates the cache entry', () => {
    const a = cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    const mutated = ISLAND_SOURCE + '<!-- a comment -->';
    const b = cachedPreprocessHydratable(mutated, '/test/A.svelte');
    expect(b).not.toBe(a);
    expect(a.transformed).not.toBe(b.transformed);
  });

  test('different file paths produce independent entries', () => {
    const a = cachedPreprocessHydratable(ISLAND_SOURCE, '/dir-a/A.svelte');
    const b = cachedPreprocessHydratable(ISLAND_SOURCE, '/dir-b/A.svelte');
    expect(a.hydratables[0]!.resolvedPath).toBe(path.resolve('/dir-a', './Foo.svelte'));
    expect(b.hydratables[0]!.resolvedPath).toBe(path.resolve('/dir-b', './Foo.svelte'));
    // Hitting either path again still returns its respective cached entry.
    expect(cachedPreprocessHydratable(ISLAND_SOURCE, '/dir-a/A.svelte')).toBe(a);
    expect(cachedPreprocessHydratable(ISLAND_SOURCE, '/dir-b/A.svelte')).toBe(b);
  });

  test('non-island source still round-trips through the cache', () => {
    const plain = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo />`;
    const r = cachedPreprocessHydratable(plain, '/test/Plain.svelte');
    expect(r.transformed).toBe(plain);
    expect(r.hydratables).toHaveLength(0);
    expect(cachedPreprocessHydratable(plain, '/test/Plain.svelte')).toBe(r);
  });

  test('__resetPreprocessMemCache forces a fresh preprocess on next call', () => {
    const a = cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    __resetPreprocessMemCache();
    const b = cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    // Different object identity proves a re-run happened (the preprocess
    // output itself is deterministic, so only identity can tell them apart).
    expect(b).not.toBe(a);
    expect(b.hydratables).toEqual(a.hydratables);
  });

  test('evictPreprocessCacheEntry drops a single entry without touching others', () => {
    const a = cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    const b = cachedPreprocessHydratable(ISLAND_SOURCE, '/test/B.svelte');
    expect(evictPreprocessCacheEntry('/test/A.svelte')).toBe(true);
    // A re-runs (new object), B is still cached (same reference).
    expect(cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte')).not.toBe(a);
    expect(cachedPreprocessHydratable(ISLAND_SOURCE, '/test/B.svelte')).toBe(b);
  });

  test('evictPreprocessCacheEntry returns false for an unknown path', () => {
    expect(evictPreprocessCacheEntry('/never/seen.svelte')).toBe(false);
  });

  test('threaded stats accumulator counts hits and misses per batch', () => {
    const stats = createPreprocessCacheStats();
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte', stats); // miss
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte', stats); // hit
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte', stats); // hit
    expect(stats).toEqual({ hits: 2, misses: 1 });
  });

  test('separate stats objects from concurrent batches do not interfere', () => {
    const batchA = createPreprocessCacheStats();
    const batchB = createPreprocessCacheStats();
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte', batchA); // miss → A
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte', batchB); // hit → B
    expect(batchA).toEqual({ hits: 0, misses: 1 });
    expect(batchB).toEqual({ hits: 1, misses: 0 });
  });

  test('omitting the stats accumulator is allowed', () => {
    // The bundler's `onLoad` is the only required caller; the parameter is
    // optional so callers (and test setups) can skip it without crashing.
    expect(() => cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte')).not.toThrow();
  });
});

describe('preprocess-cache event emission', () => {
  const received: Array<{ type: string; payload: unknown }> = [];
  const onHit = (p: MochiEventMap['preprocess-cache:hit']) => received.push({ type: 'hit', payload: p });
  const onMiss = (p: MochiEventMap['preprocess-cache:miss']) => received.push({ type: 'miss', payload: p });

  beforeEach(() => {
    received.length = 0;
    __resetPreprocessMemCache();
    mochiEvents.on('preprocess-cache:hit', onHit);
    mochiEvents.on('preprocess-cache:miss', onMiss);
  });

  afterEach(() => {
    mochiEvents.off('preprocess-cache:hit', onHit);
    mochiEvents.off('preprocess-cache:miss', onMiss);
  });

  test('emits one miss for a cold lookup', () => {
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    expect(received).toEqual([{ type: 'miss', payload: { filePath: '/test/A.svelte' } }]);
  });

  test('emits a hit on the second lookup with the same source+path', () => {
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    expect(received).toEqual([
      { type: 'miss', payload: { filePath: '/test/A.svelte' } },
      { type: 'hit', payload: { filePath: '/test/A.svelte' } },
    ]);
  });

  test('no event fires when there are no subscribers', () => {
    // Detach the listeners attached by the outer beforeEach — emission must
    // be gated on subscriber presence.
    mochiEvents.off('preprocess-cache:hit', onHit);
    mochiEvents.off('preprocess-cache:miss', onMiss);
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    expect(received).toEqual([]);
  });
});
