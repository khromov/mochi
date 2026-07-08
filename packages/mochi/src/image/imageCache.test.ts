import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Storage } from '../cache';
import { MemoryStorage } from '../cache-storage';
import { mochiEvents } from '../events';
import type { MochiImageDeleteEvent, MochiImageStoreEvent } from '../events';
import { ImageCache, originalId, variantId, type ImageCacheOptions, type RegenResult } from './imageCache';
import type { ResolvedImageSize } from './types';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-img-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  mochiEvents.all.clear();
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

// One configured size — enough for the cascade to enumerate a source's variants.
const CFG = 'cfgTHUMB';
const SIZES = { thumb: { name: 'thumb', configHash: CFG, format: 'webp', width: 100, height: 100 } } as unknown as Record<string, ResolvedImageSize>;

function makeCache(overrides: Partial<ImageCacheOptions> = {}): ImageCache {
  return new ImageCache({ cacheDir: tmp(), minTimeToStale: 60_000, maxTimeToLive: 86_400_000, sizes: SIZES, ...overrides });
}

const SRC = 'https://example.com/a.png';
const ID = variantId(SRC, CFG);

function origFn(bytes: number[], contentType = 'image/jpeg', counter?: { n: number }) {
  return async () => {
    if (counter) {
      counter.n++;
    }
    return { bytes: new Uint8Array(bytes), contentType };
  };
}

function regen(bytes: number[], counter?: { n: number }): () => Promise<RegenResult> {
  return async () => {
    if (counter) {
      counter.n++;
    }
    return { bytes: new Uint8Array(bytes), contentType: 'image/webp', width: 100, height: 100, format: 'webp' };
  };
}

describe('ImageCache.getOriginal', () => {
  test('miss regenerates, preserves content-type; subsequent read is fresh', async () => {
    const cache = makeCache();
    const counter = { n: 0 };

    const first = await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3], 'image/gif', counter));
    expect(first.status).toBe('miss');
    expect(first.entry.meta.contentType).toBe('image/gif');
    expect(Array.from(first.entry.bytes)).toEqual([1, 2, 3]);
    expect(counter.n).toBe(1);

    const second = await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3], 'image/gif', counter));
    expect(second.status).toBe('fresh');
    expect(counter.n).toBe(1);
    expect(Array.from(second.entry.bytes)).toEqual([1, 2, 3]);
  });

  test('soft invalidation serves stale and revalidates in the background', async () => {
    const cache = makeCache();
    const counter = { n: 0 };
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1], 'image/jpeg', counter));

    await cache.invalidateOriginal(SRC, false); // markStale
    const stale = await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([2], 'image/jpeg', counter));
    expect(stale.status).toBe('stale');
    expect(Array.from(stale.entry.bytes)).toEqual([1]); // old bytes served immediately

    await Bun.sleep(20);
    expect(counter.n).toBe(2); // revalidated in the background
  });

  test('hard invalidation makes the next read a miss', async () => {
    const cache = makeCache();
    const counter = { n: 0 };
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1], 'image/jpeg', counter));

    await cache.invalidateOriginal(SRC, true); // delete
    const miss = await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([2], 'image/jpeg', counter));
    expect(miss.status).toBe('miss');
    expect(counter.n).toBe(2);
    expect(Array.from(miss.entry.bytes)).toEqual([2]);
  });

  test('coalesces concurrent misses into one fetch', async () => {
    const cache = makeCache();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchFn = async () => {
      calls++;
      await gate;
      return { bytes: new Uint8Array([7]), contentType: 'image/jpeg' };
    };

    const a = cache.getOriginal(SRC, 60_000, 86_400_000, fetchFn);
    const b = cache.getOriginal(SRC, 60_000, 86_400_000, fetchFn);
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
  });

  test('bytes persist through storage across a fresh cache instance', async () => {
    const dir = tmp();
    const opts = { cacheDir: dir, minTimeToStale: 60_000, maxTimeToLive: 86_400_000, sizes: SIZES };
    const a = new ImageCache(opts);
    await a.getOriginal(SRC, 60_000, 86_400_000, origFn([4, 5, 6], 'image/png'));

    // A brand-new cache over the same directory reads the persisted original.
    const b = new ImageCache(opts);
    let refetched = false;
    const read = await b.getOriginal(SRC, 60_000, 86_400_000, async () => {
      refetched = true;
      return { bytes: new Uint8Array([0]), contentType: 'image/png' };
    });
    expect(refetched).toBe(false);
    expect(read.status).toBe('fresh');
    expect(Array.from(read.entry.bytes)).toEqual([4, 5, 6]);
  });
});

describe('ImageCache.getVariant (mirrors the original)', () => {
  async function warm(cache: ImageCache): Promise<void> {
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3]));
  }

  test('miss regenerates; subsequent read is fresh while the original is fresh', async () => {
    const cache = makeCache();
    await warm(cache);
    const counter = { n: 0 };

    const first = await cache.getVariant(SRC, ID, 'webp', regen([9, 9], counter));
    expect(first.status).toBe('miss');
    expect(Array.from(first.entry.bytes)).toEqual([9, 9]);
    expect(first.entry.meta.width).toBe(100);
    expect(counter.n).toBe(1);

    const second = await cache.getVariant(SRC, ID, 'webp', regen([9, 9], counter));
    expect(second.status).toBe('fresh');
    expect(counter.n).toBe(1);
  });

  test('a soft-invalidated original serves the variant stale and revalidates', async () => {
    const cache = makeCache();
    await warm(cache);
    const counter = { n: 0 };
    await cache.getVariant(SRC, ID, 'webp', regen([1], counter)); // warm variant

    await cache.invalidateOriginal(SRC, false); // original → stale
    const stale = await cache.getVariant(SRC, ID, 'webp', regen([2], counter));
    expect(stale.status).toBe('stale');
    expect(Array.from(stale.entry.bytes)).toEqual([1]); // old bytes served immediately

    await Bun.sleep(20);
    expect(counter.n).toBe(2); // variant regenerated in the background
  });

  test('a hard-invalidated original makes the variant miss and re-fetch', async () => {
    const cache = makeCache();
    await warm(cache);
    const counter = { n: 0 };
    await cache.getVariant(SRC, ID, 'webp', regen([1], counter));

    await cache.invalidateOriginal(SRC, true); // deletes original + cascades to the variant
    const miss = await cache.getVariant(SRC, ID, 'webp', regen([2], counter));
    expect(miss.status).toBe('miss');
    expect(counter.n).toBe(2);
    expect(Array.from(miss.entry.bytes)).toEqual([2]);
  });
});

describe('ImageCache.invalidateOriginal cascade', () => {
  test('hard invalidation removes the source variants and placeholder', async () => {
    const cache = makeCache();
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3]));
    await cache.getVariant(SRC, ID, 'webp', regen([9, 9]));
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', 0);
    expect(await cache.getPlaceholder(SRC)).toBe('data:image/png;base64,AAAA');

    const deletes: MochiImageDeleteEvent[] = [];
    mochiEvents.on('image:delete', (e) => deletes.push(e));
    await cache.invalidateOriginal(SRC, true);

    expect(deletes.map((d) => d.kind).sort()).toEqual(['original', 'placeholder', 'variant']);
    expect(deletes.every((d) => d.reason === 'invalidated')).toBe(true);
    // Each delete reports the bytes it reclaimed (read from the stored blob).
    expect(deletes.every((d) => d.size > 0)).toBe(true);
    expect(deletes.find((d) => d.kind === 'original')?.size).toBe(3); // [1,2,3]
    expect(deletes.find((d) => d.kind === 'variant')?.size).toBe(2); // [9,9]
    expect(await cache.getPlaceholder(SRC)).toBeNull();
  });

  test('is a no-op when nothing is cached', async () => {
    const cache = makeCache();
    await expect(cache.invalidateOriginal('https://example.com/missing.png', true)).resolves.toBeUndefined();
  });
});

describe('ImageCache.clearAll', () => {
  test('empties originals, variants, and placeholders so the next read is a miss', async () => {
    const cache = makeCache();
    const origCounter = { n: 0 };
    const varCounter = { n: 0 };
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3], 'image/png', origCounter));
    await cache.getVariant(SRC, ID, 'webp', regen([9, 9], varCounter));
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', 0);
    expect(origCounter.n).toBe(1);
    expect(varCounter.n).toBe(1);

    await cache.clearAll();

    expect(await cache.getPlaceholder(SRC)).toBeNull();
    // Everything regenerates from scratch after a clear.
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3], 'image/png', origCounter));
    await cache.getVariant(SRC, ID, 'webp', regen([9, 9], varCounter));
    expect(origCounter.n).toBe(2);
    expect(varCounter.n).toBe(2);
  });

  test('is a no-op on an empty cache', async () => {
    const cache = makeCache();
    await expect(cache.clearAll()).resolves.toBeUndefined();
  });
});

describe('ImageCache.getPlaceholder', () => {
  test('round-trips a data URL and misses before it is set', async () => {
    const cache = makeCache();
    expect(await cache.getPlaceholder(SRC)).toBeNull();
    await cache.setPlaceholder(SRC, 'data:image/png;base64,ZZZZ', 0);
    expect(await cache.getPlaceholder(SRC)).toBe('data:image/png;base64,ZZZZ');
  });
});

describe('ImageCache.sweep', () => {
  test('leaves entries within the window untouched', async () => {
    const cache = makeCache();
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3]));
    expect(await cache.sweep(Date.now())).toEqual({ removedVariants: 0, removedOriginals: 0 });
  });

  test('reclaims entries past the window and forces a re-fetch', async () => {
    const cache = makeCache({ minTimeToStale: 10, maxTimeToLive: 1_000 });
    const counter = { n: 0 };
    await cache.getOriginal(SRC, 10, 1_000, origFn([1, 2, 3], 'image/jpeg', counter));

    const swept = await cache.sweep(Date.now() + 10_000);
    expect(swept.removedVariants).toBeGreaterThan(0);

    const after = await cache.getOriginal(SRC, 10, 1_000, origFn([1, 2, 3], 'image/jpeg', counter));
    expect(after.status).toBe('miss'); // reclaimed → re-fetched
    expect(counter.n).toBe(2);
  });
});

describe('ImageCache lifecycle events', () => {
  test('getOriginal miss emits image:store kind:original', async () => {
    const cache = makeCache();
    const stores: MochiImageStoreEvent[] = [];
    mochiEvents.on('image:store', (e) => stores.push(e));

    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3], 'image/jpeg'));
    const original = stores.filter((s) => s.kind === 'original');
    expect(original).toHaveLength(1);
    expect(original[0]).toMatchObject({ kind: 'original', src: SRC, id: originalId(SRC), contentType: 'image/jpeg', width: 0, height: 0, format: '' });
    expect(original[0]!.size).toBeGreaterThan(0);
  });

  test('variant miss emits image:store kind:variant with dimensions', async () => {
    const cache = makeCache();
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3]));
    const stores: MochiImageStoreEvent[] = [];
    mochiEvents.on('image:store', (e) => stores.push(e));

    await cache.getVariant(SRC, ID, 'webp', regen([9, 9]));
    const variant = stores.filter((s) => s.kind === 'variant');
    expect(variant).toHaveLength(1);
    expect(variant[0]).toMatchObject({ kind: 'variant', src: SRC, id: ID, contentType: 'image/webp', width: 100, height: 100, format: 'webp' });
  });

  test('setPlaceholder emits image:store kind:placeholder', async () => {
    const cache = makeCache();
    const stores: MochiImageStoreEvent[] = [];
    mochiEvents.on('image:store', (e) => stores.push(e));

    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', 0);
    expect(stores).toHaveLength(1);
    expect(stores[0]).toMatchObject({ kind: 'placeholder', src: SRC, contentType: '', format: '' });
  });
});

describe('ImageCache custom storage', () => {
  test('a MemoryStorage-backed cache behaves like the FileStorage default', async () => {
    const cache = makeCache({ storage: new MemoryStorage() });
    const counter = { n: 0 };

    const first = await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3], 'image/gif', counter));
    expect(first.status).toBe('miss');
    expect(counter.n).toBe(1);

    const second = await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3], 'image/gif', counter));
    expect(second.status).toBe('fresh');
    expect(counter.n).toBe(1);

    const variant = await cache.getVariant(SRC, ID, 'webp', regen([9, 9]));
    expect(variant.status).toBe('miss');
    expect(Array.from(variant.entry.bytes)).toEqual([9, 9]);
  });

  test('sweep reclaims aged entries when the MemoryStorage was configured with maxAge', async () => {
    const cache = makeCache({ storage: new MemoryStorage({ maxAge: 1_000 }), minTimeToStale: 10, maxTimeToLive: 1_000 });
    const counter = { n: 0 };
    await cache.getOriginal(SRC, 10, 1_000, origFn([1, 2, 3], 'image/jpeg', counter));

    const swept = await cache.sweep(Date.now() + 10_000);
    expect(swept.removedVariants).toBeGreaterThan(0);

    const after = await cache.getOriginal(SRC, 10, 1_000, origFn([1, 2, 3], 'image/jpeg', counter));
    expect(after.status).toBe('miss'); // reclaimed → re-fetched
    expect(counter.n).toBe(2);
  });

  test('sweep on a storage without maxAge/sweep support degrades to zero counts', async () => {
    // A minimal Storage implementing only the 4 core methods — no `sweep`.
    const store = new Map<string, unknown>();
    const bare: Storage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
      clear: () => void store.clear(),
    };

    const cache = makeCache({ storage: bare });
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn([1, 2, 3]));

    await expect(cache.sweep(Date.now() + 1_000_000)).resolves.toEqual({ removedVariants: 0, removedOriginals: 0 });
  });
});
