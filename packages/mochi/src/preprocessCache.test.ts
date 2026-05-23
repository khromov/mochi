import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { __resetPreprocessMemCache, cachedPreprocessHydratable, consumePreprocessCacheStats } from './preprocessCache';
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
    // Different object identity proves a re-run happened. The `nanoid(8)` baseId
    // baked into the transformed source regenerates per call, so the transformed
    // strings differ — but the deterministic hydratables array stays equal.
    expect(b).not.toBe(a);
    expect(b.hydratables).toEqual(a.hydratables);
  });

  test('consumePreprocessCacheStats reports counts and resets them', () => {
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte'); // miss
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte'); // hit
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte'); // hit
    const first = consumePreprocessCacheStats();
    expect(first).toEqual({ hits: 2, misses: 1 });
    // Second consume is post-reset.
    expect(consumePreprocessCacheStats()).toEqual({ hits: 0, misses: 0 });
  });
});

describe('preprocess-cache event emission', () => {
  const received: Array<{ type: string; payload: unknown }> = [];
  const onHit = (p: MochiEventMap['preprocess-cache:hit']) => received.push({ type: 'hit', payload: p });
  const onMiss = (p: MochiEventMap['preprocess-cache:miss']) => received.push({ type: 'miss', payload: p });

  beforeEach(() => {
    received.length = 0;
    __resetPreprocessMemCache();
  });

  afterEach(() => {
    mochiEvents.off('preprocess-cache:hit', onHit);
    mochiEvents.off('preprocess-cache:miss', onMiss);
  });

  test('does NOT emit events when no subscribers are attached', () => {
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    expect(received).toHaveLength(0);
    // Stats still tick even without subscribers — they're free integer increments
    // and the summary path needs them.
    expect(consumePreprocessCacheStats()).toEqual({ hits: 1, misses: 1 });
  });

  test('emits hit + miss events when subscribers are attached', () => {
    mochiEvents.on('preprocess-cache:hit', onHit);
    mochiEvents.on('preprocess-cache:miss', onMiss);

    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte');

    expect(received).toEqual([
      { type: 'miss', payload: { filePath: '/test/A.svelte' } },
      { type: 'hit', payload: { filePath: '/test/A.svelte' } },
    ]);
  });
});
