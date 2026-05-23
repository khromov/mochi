import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { __resetPreprocessMemCache, cachedPreprocessHydratable } from './preprocessCache';
import { PREPROCESS_LOGIC_VERSION } from './svelteAstPreprocess';

const SCRIPT = (imports: string) => `<script>\n${imports}\n</script>\n`;
const ISLAND_SOURCE = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate />`;

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(path.join(tmpdir(), 'mochi-preprocess-cache-test-'));
  __resetPreprocessMemCache();
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

function diskKey(source: string, filePath: string): string {
  return createHash('sha256').update(source).update('\0').update(filePath).update('\0').update(PREPROCESS_LOGIC_VERSION).digest('hex');
}

describe('cachedPreprocessHydratable', () => {
  test('first call writes cache, second call reads from cache', () => {
    const first = cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte', cacheDir);
    expect(first.hydratables).toHaveLength(1);

    const filesBefore = readdirSync(cacheDir).length;
    expect(filesBefore).toBe(1);

    // Drop in-memory cache so the second call must come from disk.
    __resetPreprocessMemCache();

    const second = cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte', cacheDir);
    expect(second).toEqual(first);
    // Disk shouldn't grow on a hit.
    expect(readdirSync(cacheDir).length).toBe(filesBefore);
  });

  test('cache miss when source changes', () => {
    const a = cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte', cacheDir);
    const mutated = ISLAND_SOURCE + '<!-- a comment -->';
    const b = cachedPreprocessHydratable(mutated, '/test/A.svelte', cacheDir);

    expect(a.transformed).not.toBe(b.transformed);
    expect(readdirSync(cacheDir).length).toBe(2);
  });

  test('cache miss when file path changes', () => {
    cachedPreprocessHydratable(ISLAND_SOURCE, '/test/A.svelte', cacheDir);
    cachedPreprocessHydratable(ISLAND_SOURCE, '/elsewhere/A.svelte', cacheDir);

    // Different file path resolves child imports differently, so results
    // differ and the cache must hold two distinct entries.
    expect(readdirSync(cacheDir).length).toBe(2);
  });

  test('different file paths yield different hydratable resolvedPath values', () => {
    const a = cachedPreprocessHydratable(ISLAND_SOURCE, '/dir-a/A.svelte', cacheDir);
    const b = cachedPreprocessHydratable(ISLAND_SOURCE, '/dir-b/A.svelte', cacheDir);

    expect(a.hydratables[0]!.resolvedPath).not.toBe(b.hydratables[0]!.resolvedPath);
    expect(a.hydratables[0]!.resolvedPath).toBe(path.resolve('/dir-a', './Foo.svelte'));
    expect(b.hydratables[0]!.resolvedPath).toBe(path.resolve('/dir-b', './Foo.svelte'));
  });

  test('corrupt cache file falls through to fresh preprocess and is overwritten', () => {
    const filePath = '/test/A.svelte';
    const key = diskKey(ISLAND_SOURCE, filePath);
    const diskFile = path.join(cacheDir, `${key}.json`);

    writeFileSync(diskFile, '{not valid json');

    const result = cachedPreprocessHydratable(ISLAND_SOURCE, filePath, cacheDir);
    expect(result.hydratables).toHaveLength(1);

    // The corrupt file should have been overwritten with valid JSON.
    const refreshed = cachedPreprocessHydratable(ISLAND_SOURCE, filePath, cacheDir);
    expect(refreshed).toEqual(result);
  });

  test('non-island source still round-trips through the cache', () => {
    const plain = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo />`;
    const r = cachedPreprocessHydratable(plain, '/test/Plain.svelte', cacheDir);
    expect(r.transformed).toBe(plain);
    expect(r.hydratables).toHaveLength(0);
    expect(r.serverIslands).toHaveLength(0);
    // Cache writes happen even on the fast-path output — that's fine,
    // hits are still cheaper than re-running the string scan + function call.
    expect(readdirSync(cacheDir).length).toBe(1);
  });
});
