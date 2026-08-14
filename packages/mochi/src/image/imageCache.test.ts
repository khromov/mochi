import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Storage } from '../cache/cache';
import { MemoryStorage } from '../cache/cache-storage';
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
  // dispose() drops each cache's cascade subscription; `all.clear()` alone would
  // leave the emitter's name table populated.
  for (const cache of caches.splice(0)) {
    cache.dispose();
  }
  mochiEvents.all.clear();
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

// One configured size — enough for the cascade to enumerate a source's variants.
const CFG = 'cfgTHUMB';
const SIZES = { thumb: { name: 'thumb', configHash: CFG, format: 'webp', width: 100, height: 100 } } as unknown as Record<string, ResolvedImageSize>;

const caches: ImageCache[] = [];
function makeCache(overrides: Partial<ImageCacheOptions> = {}): ImageCache {
  const cache = new ImageCache({ cacheDir: tmp(), minTimeToStale: 60_000, maxTimeToLive: 86_400_000, sizes: SIZES, ...overrides });
  caches.push(cache);
  return cache;
}

const SRC = 'https://example.com/a.png';
const ID = variantId(SRC, CFG);

// Wait for a fire-and-forget background revalidation to land. A fixed `Bun.sleep`
// flakes when the regen's disk write is slower than the wait (Windows CI), so poll
// the observable effect until it holds or a generous deadline passes. The predicate
// may be async so callers can drive convergence from within it (a variant only
// re-regenerates when it is read).
async function settle(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) {
    await Bun.sleep(5);
  }
}

function origFn(bytes: number[], contentType = 'image/jpeg', counter?: { n: number }) {
  return async () => {
    if (counter) {
      counter.n++;
    }
    return { bytes: new Uint8Array(bytes), contentType };
  };
}

// Mirrors production regenerate callbacks: read the shared original through the
// cache and stamp the generation of the bytes actually used.
function regen(cache: ImageCache, bytes: number[], counter?: { n: number }): () => Promise<RegenResult> {
  return async () => {
    if (counter) {
      counter.n++;
    }
    const { entry } = await cache.getOriginal(SRC, origFn([1, 2, 3]));
    return { bytes: new Uint8Array(bytes), contentType: 'image/webp', width: 100, height: 100, format: 'webp', originalCreatedAt: entry.meta.createdAt };
  };
}

describe('ImageCache.getOriginal', () => {
  test('miss regenerates, preserves content-type; subsequent read is fresh', async () => {
    const cache = makeCache();
    const counter = { n: 0 };

    const first = await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/gif', counter));
    expect(first.status).toBe('miss');
    expect(first.entry.meta.contentType).toBe('image/gif');
    expect(Array.from(first.entry.bytes)).toEqual([1, 2, 3]);
    expect(counter.n).toBe(1);

    const second = await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/gif', counter));
    expect(second.status).toBe('fresh');
    expect(counter.n).toBe(1);
    expect(Array.from(second.entry.bytes)).toEqual([1, 2, 3]);
  });

  test('soft invalidation serves stale and revalidates in the background', async () => {
    const cache = makeCache();
    const counter = { n: 0 };
    await cache.getOriginal(SRC, origFn([1], 'image/jpeg', counter));

    await cache.invalidateOriginal(SRC, false); // markStale
    const stale = await cache.getOriginal(SRC, origFn([2], 'image/jpeg', counter));
    expect(stale.status).toBe('stale');
    expect(Array.from(stale.entry.bytes)).toEqual([1]); // old bytes served immediately

    await settle(() => counter.n === 2);
    expect(counter.n).toBe(2); // revalidated in the background
  });

  test('hard invalidation makes the next read a miss', async () => {
    const cache = makeCache();
    const counter = { n: 0 };
    await cache.getOriginal(SRC, origFn([1], 'image/jpeg', counter));

    await cache.invalidateOriginal(SRC, true); // delete
    const miss = await cache.getOriginal(SRC, origFn([2], 'image/jpeg', counter));
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

    const a = cache.getOriginal(SRC, fetchFn);
    const b = cache.getOriginal(SRC, fetchFn);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(calls).toBe(1);
    expect(ra.status).toBe('miss');
    expect(Array.from(ra.entry.bytes)).toEqual([7]);
    expect(Array.from(rb.entry.bytes)).toEqual([7]);
  });

  test('bytes persist through storage across a fresh cache instance', async () => {
    const dir = tmp();
    const opts = { cacheDir: dir, minTimeToStale: 60_000, maxTimeToLive: 86_400_000, sizes: SIZES };
    const a = new ImageCache(opts);
    await a.getOriginal(SRC, origFn([4, 5, 6], 'image/png'));

    // A brand-new cache over the same directory reads the persisted original.
    const b = new ImageCache(opts);
    let refetched = false;
    const read = await b.getOriginal(SRC, async () => {
      refetched = true;
      return { bytes: new Uint8Array([0]), contentType: 'image/png' };
    });
    expect(refetched).toBe(false);
    expect(read.status).toBe('fresh');
    expect(Array.from(read.entry.bytes)).toEqual([4, 5, 6]);
  });
});

describe('ImageCache.getVariant (generation-stamped)', () => {
  async function warm(cache: ImageCache): Promise<void> {
    await cache.getOriginal(SRC, origFn([1, 2, 3]));
  }

  test('miss regenerates; subsequent read is fresh while the original is fresh', async () => {
    const cache = makeCache();
    await warm(cache);
    const counter = { n: 0 };

    const first = await cache.getVariant(SRC, ID, regen(cache, [9, 9], counter));
    expect(first.status).toBe('miss');
    expect(Array.from(first.entry.bytes)).toEqual([9, 9]);
    expect(first.entry.meta.width).toBe(100);
    expect(counter.n).toBe(1);

    const second = await cache.getVariant(SRC, ID, regen(cache, [9, 9], counter));
    expect(second.status).toBe('fresh');
    expect(counter.n).toBe(1);
  });

  test('a soft-invalidated original serves the variant stale and revalidates', async () => {
    const cache = makeCache();
    await warm(cache);
    const counter = { n: 0 };
    await cache.getVariant(SRC, ID, regen(cache, [1], counter)); // warm variant

    await cache.invalidateOriginal(SRC, false); // original → stale
    const stale = await cache.getVariant(SRC, ID, regen(cache, [2], counter));
    expect(stale.status).toBe('stale');
    expect(Array.from(stale.entry.bytes)).toEqual([1]); // old bytes served immediately

    await settle(() => counter.n === 2);
    expect(counter.n).toBe(2); // variant regenerated in the background
  });

  test('a hard-invalidated original makes the variant miss and re-fetch', async () => {
    const cache = makeCache();
    await warm(cache);
    const counter = { n: 0 };
    await cache.getVariant(SRC, ID, regen(cache, [1], counter));

    await cache.invalidateOriginal(SRC, true); // deletes original + cascades to the variant
    const miss = await cache.getVariant(SRC, ID, regen(cache, [2], counter));
    expect(miss.status).toBe('miss');
    expect(counter.n).toBe(2);
    expect(Array.from(miss.entry.bytes)).toEqual([2]);
  });

  test('a soft invalidation propagates refreshed original bytes to the variant', async () => {
    const cache = makeCache();
    let upstream = [1];
    const fetchFn = async () => ({ bytes: new Uint8Array(upstream), contentType: 'image/jpeg' });
    // A "transform" whose output is derived from the original bytes it read, so
    // the assertion can tell which generation the variant was encoded from.
    const transform = (): (() => Promise<RegenResult>) => async () => {
      const { entry } = await cache.getOriginal(SRC, fetchFn);
      return { bytes: new Uint8Array([entry.bytes[0]! * 10]), contentType: 'image/webp', width: 100, height: 100, format: 'webp', originalCreatedAt: entry.meta.createdAt };
    };

    await cache.getOriginal(SRC, fetchFn);
    const first = await cache.getVariant(SRC, ID, transform());
    expect(Array.from(first.entry.bytes)).toEqual([10]);

    upstream = [2];
    await cache.invalidateOriginal(SRC, false);
    // First request after the invalidation serves the in-hand bytes stale.
    const stale = await cache.getVariant(SRC, ID, transform());
    expect(stale.status).toBe('stale');
    expect(Array.from(stale.entry.bytes)).toEqual([10]);

    // Converges once the original's background refresh lands: the generation
    // mismatch forces one more regen against the new bytes — the variant must not
    // stay pinned to [10] as fresh. Each read is what drives the regen, so poll by
    // re-reading, bounded by a deadline rather than a fixed request count (a
    // Windows regen write can outlast any fixed budget).
    let bytes: number[] = [];
    await settle(async () => {
      const read = await cache.getVariant(SRC, ID, transform());
      bytes = Array.from(read.entry.bytes);
      return bytes[0] === 20;
    });
    expect(bytes).toEqual([20]);
  });

  test('cold-start concurrent variant requests coalesce into one regeneration', async () => {
    const cache = makeCache();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const gated = async (): Promise<RegenResult> => {
      calls++;
      await gate;
      const { entry } = await cache.getOriginal(SRC, origFn([1, 2, 3]));
      return { bytes: new Uint8Array([9]), contentType: 'image/webp', width: 100, height: 100, format: 'webp', originalCreatedAt: entry.meta.createdAt };
    };

    // Nothing cached at all: neither request may clear the other's in-flight run.
    const a = cache.getVariant(SRC, ID, gated);
    const b = cache.getVariant(SRC, ID, gated);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(calls).toBe(1);
    expect(ra.status).toBe('miss');
    expect(Array.from(rb.entry.bytes)).toEqual([9]);
  });
});

describe('ImageCache.invalidateOriginal cascade', () => {
  test('hard invalidation removes the source variants and placeholder', async () => {
    const cache = makeCache();
    const orig = await cache.getOriginal(SRC, origFn([1, 2, 3]));
    await cache.getVariant(SRC, ID, regen(cache, [9, 9]));
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', orig.entry.meta.createdAt);
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
    const orig = await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/png', origCounter));
    await cache.getVariant(SRC, ID, regen(cache, [9, 9], varCounter));
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', orig.entry.meta.createdAt);
    expect(origCounter.n).toBe(1);
    expect(varCounter.n).toBe(1);
    expect(await cache.count()).toBe(3); // original + variant + placeholder

    await cache.clearAll();

    expect(await cache.count()).toBe(0);
    expect(await cache.getPlaceholder(SRC)).toBeNull();
    // Everything regenerates from scratch after a clear.
    await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/png', origCounter));
    await cache.getVariant(SRC, ID, regen(cache, [9, 9], varCounter));
    expect(origCounter.n).toBe(2);
    expect(varCounter.n).toBe(2);
  });

  test('is a no-op on an empty cache', async () => {
    const cache = makeCache();
    await expect(cache.clearAll()).resolves.toBeUndefined();
  });
});

describe('ImageCache.keys / inspect (dev debug bar)', () => {
  test('keys lists cached entries and inspect returns the stored envelope', async () => {
    const cache = makeCache();
    await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/png'));

    const keys = await cache.keys();
    const origKey = keys.find((k) => k.includes(SRC));
    expect(origKey).toBe(`MochiImage:Original:${SRC}`);

    const entry = (await cache.inspect(origKey!)) as { value: unknown; createdAt: number };
    expect(entry).not.toBeNull();
    expect(typeof entry.createdAt).toBe('number');

    expect(await cache.inspect('MochiImage:Original:https://example.com/nope.png')).toBeNull();
  });
});

describe('ImageCache.getPlaceholder', () => {
  test('round-trips a data URL and misses before it is set', async () => {
    const cache = makeCache();
    expect(await cache.getPlaceholder(SRC)).toBeNull();
    await cache.setPlaceholder(SRC, 'data:image/png;base64,ZZZZ', 0);
    expect(await cache.getPlaceholder(SRC)).toBe('data:image/png;base64,ZZZZ');
  });

  test('a refreshed original invalidates the placeholder (generation gating)', async () => {
    const cache = makeCache();
    let upstream = [1];
    const fetchFn = async () => ({ bytes: new Uint8Array(upstream), contentType: 'image/jpeg' });
    const orig = await cache.getOriginal(SRC, fetchFn);
    await cache.setPlaceholder(SRC, 'data:image/png;base64,OLD', orig.entry.meta.createdAt);
    expect(await cache.getPlaceholder(SRC)).toBe('data:image/png;base64,OLD');

    // Refresh the original to a new generation (soft invalidate → background refetch).
    upstream = [2];
    await cache.invalidateOriginal(SRC, false);
    await cache.getOriginal(SRC, fetchFn); // serves stale, kicks the refresh
    let refreshed = orig.entry.meta.createdAt;
    await settle(async () => {
      refreshed = (await cache.getOriginal(SRC, fetchFn)).entry.meta.createdAt;
      return refreshed !== orig.entry.meta.createdAt;
    });
    expect(refreshed).not.toBe(orig.entry.meta.createdAt);

    // The old generation's blur must not be served against the new original.
    expect(await cache.getPlaceholder(SRC)).toBeNull();
    await cache.setPlaceholder(SRC, 'data:image/png;base64,NEW', refreshed);
    expect(await cache.getPlaceholder(SRC)).toBe('data:image/png;base64,NEW');
  });
});

describe('ImageCache.setPlaceholder', () => {
  test('overwrites an existing placeholder', async () => {
    const cache = makeCache();
    await cache.setPlaceholder(SRC, 'data:image/png;base64,OLD', 0);
    await cache.setPlaceholder(SRC, 'data:image/png;base64,NEW', 0);
    expect(await cache.getPlaceholder(SRC)).toBe('data:image/png;base64,NEW');
  });

  test('a rewrite never leaves the key absent', async () => {
    // Regression: this used to `delete` then re-`fetch`, so for most of every
    // rewrite the placeholder was missing — concurrent readers each saw a miss and
    // kicked off their own recompute, and the debug bar's entry lookup 410'd.
    const cache = makeCache();
    const key = `MochiImage:Placeholder:${SRC}`;
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', 0);

    let sawMiss = false;
    let stop = false;
    const reader = (async () => {
      while (!stop) {
        if ((await cache.inspect(key)) == null) {
          sawMiss = true;
        }
        await Promise.resolve();
      }
    })();
    for (let i = 0; i < 20; i++) {
      await cache.setPlaceholder(SRC, `data:image/png;base64,GEN${i}`, i);
    }
    stop = true;
    await reader;

    expect(sawMiss).toBe(false);
  });
});

describe('ImageCache.sweep', () => {
  test('leaves entries within the window untouched', async () => {
    const cache = makeCache();
    await cache.getOriginal(SRC, origFn([1, 2, 3]));
    expect(await cache.sweep(Date.now())).toEqual({ removedVariants: 0, removedOriginals: 0, removedOther: 0 });
  });

  test('reclaims entries past the window and forces a re-fetch', async () => {
    const cache = makeCache({ minTimeToStale: 10, maxTimeToLive: 1_000 });
    const counter = { n: 0 };
    await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/jpeg', counter));

    const swept = await cache.sweep(Date.now() + 10_000);
    expect(swept.removedOriginals).toBe(1);
    expect(swept.removedVariants).toBe(0);

    const after = await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/jpeg', counter));
    expect(after.status).toBe('miss'); // reclaimed → re-fetched
    expect(counter.n).toBe(2);
  });

  test('attributes variants and placeholders apart from originals', async () => {
    const cache = makeCache({ minTimeToStale: 10, maxTimeToLive: 1_000 });
    await cache.getOriginal(SRC, origFn([1, 2, 3]));
    await cache.getVariant(SRC, ID, regen(cache, [9, 9]));
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', 0);

    // One original; the variant and the placeholder both bucket as variants. `removedOther` is asserted `>= 0` rather
    // than exactly 0: with `crossProcessInflight` on (the image cache's default), a miss briefly writes a
    // `mochi:inflight:` marker file, and if its post-completion cleanup hasn't landed when the sweep runs — a timing
    // window a slow filesystem can widen — the sweep correctly reclaims it and, since its key is not an original/
    // variant/placeholder, counts it under `removedOther`. That's the documented catch-all, not a miscount, so pinning
    // it to 0 makes the test flake on the marker-cleanup race without testing anything this case is about.
    const swept = await cache.sweep(Date.now() + 10_000);
    expect(swept.removedOriginals).toBe(1);
    expect(swept.removedVariants).toBe(2);
    expect(swept.removedOther).toBeGreaterThanOrEqual(0);
  });

  test('counts reconcile with what the backend actually removed', async () => {
    const storage = new MemoryStorage({ maxAge: 1_000 });
    const cache = makeCache({ storage, minTimeToStale: 10, maxTimeToLive: 1_000 });
    await cache.getOriginal(SRC, origFn([1, 2, 3]));
    await cache.getVariant(SRC, ID, regen(cache, [9, 9]));
    const stored = (await storage.keys()).length;

    const swept = await cache.sweep(Date.now() + 10_000);
    expect(swept.removedVariants + swept.removedOriginals + swept.removedOther).toBe(stored);
  });

  test('a swept inflight marker is counted, not silently dropped', async () => {
    const storage = new MemoryStorage({ maxAge: 1_000 });
    const cache = makeCache({ storage, minTimeToStale: 10, maxTimeToLive: 1_000 });
    await cache.getOriginal(SRC, origFn([1, 2, 3]));
    // A marker outliving its run (e.g. a peer crashed mid-regen). It matches no
    // image prefix, so it used to vanish from the totals and undercount the sweep.
    await storage.setItem(`mochi:inflight:MochiImage:Original:${SRC}`, { startedAt: 0, runId: 'x' });

    const swept = await cache.sweep(Date.now() + 10_000);
    expect(swept).toEqual({ removedVariants: 0, removedOriginals: 1, removedOther: 1 });
  });
});

describe('ImageCache lifecycle events', () => {
  test('getOriginal miss emits image:store kind:original', async () => {
    const cache = makeCache();
    const stores: MochiImageStoreEvent[] = [];
    mochiEvents.on('image:store', (e) => stores.push(e));

    await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/jpeg'));
    const original = stores.filter((s) => s.kind === 'original');
    expect(original).toHaveLength(1);
    expect(original[0]).toMatchObject({ kind: 'original', src: SRC, id: originalId(SRC), contentType: 'image/jpeg', width: 0, height: 0, format: '' });
    expect(original[0]!.size).toBeGreaterThan(0);
  });

  test('variant miss emits image:store kind:variant with dimensions', async () => {
    const cache = makeCache();
    await cache.getOriginal(SRC, origFn([1, 2, 3]));
    const stores: MochiImageStoreEvent[] = [];
    mochiEvents.on('image:store', (e) => stores.push(e));

    await cache.getVariant(SRC, ID, regen(cache, [9, 9]));
    const variant = stores.filter((s) => s.kind === 'variant');
    expect(variant).toHaveLength(1);
    expect(variant[0]).toMatchObject({ kind: 'variant', src: SRC, id: ID, contentType: 'image/webp', width: 100, height: 100, format: 'webp' });
  });

  test('setPlaceholder emits image:store kind:placeholder', async () => {
    const cache = makeCache();
    const stores: MochiImageStoreEvent[] = [];
    mochiEvents.on('image:store', (e) => stores.push(e));

    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', 0);
    // Filter by kind like the two tests above: the bus is process-global, so a
    // straggler emitted by an earlier test's fire-and-forget work can land in
    // this listener's window (observed on Windows CI, where `stores` arrived
    // with 2 entries). Asserting one *placeholder* event still catches the
    // regression this test is for — a setPlaceholder that emits twice or wrong.
    const placeholders = stores.filter((s) => s.kind === 'placeholder');
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]).toMatchObject({ kind: 'placeholder', src: SRC, contentType: '', format: '' });
  });
});

describe('ImageCache custom storage', () => {
  test('a MemoryStorage-backed cache behaves like the FileStorage default', async () => {
    const cache = makeCache({ storage: new MemoryStorage() });
    const counter = { n: 0 };

    const first = await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/gif', counter));
    expect(first.status).toBe('miss');
    expect(counter.n).toBe(1);

    const second = await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/gif', counter));
    expect(second.status).toBe('fresh');
    expect(counter.n).toBe(1);

    const variant = await cache.getVariant(SRC, ID, regen(cache, [9, 9]));
    expect(variant.status).toBe('miss');
    expect(Array.from(variant.entry.bytes)).toEqual([9, 9]);
  });

  test('sweep reclaims aged entries when the MemoryStorage was configured with maxAge', async () => {
    const cache = makeCache({ storage: new MemoryStorage({ maxAge: 1_000 }), minTimeToStale: 10, maxTimeToLive: 1_000 });
    const counter = { n: 0 };
    await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/jpeg', counter));

    const swept = await cache.sweep(Date.now() + 10_000);
    expect(swept.removedOriginals).toBe(1);

    const after = await cache.getOriginal(SRC, origFn([1, 2, 3], 'image/jpeg', counter));
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
    await cache.getOriginal(SRC, origFn([1, 2, 3]));

    await expect(cache.sweep(Date.now() + 1_000_000)).resolves.toEqual({ removedVariants: 0, removedOriginals: 0, removedOther: 0 });
  });

  test('a backend that sweeps but does not report keys counts as unattributed', async () => {
    const store = new Map<string, unknown>();
    // Honours the pre-`reportKeys` contract: sweeps, but names nothing.
    const opaque: Storage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
      clear: () => void store.clear(),
      sweep: () => {
        const removed = store.size;
        store.clear();
        return { removed };
      },
    };

    const cache = makeCache({ storage: opaque });
    await cache.getOriginal(SRC, origFn([1, 2, 3]));

    // This used to report the original as a *variant*; unattributed is the honest answer.
    const swept = await cache.sweep(Date.now() + 1_000_000);
    expect(swept).toEqual({ removedVariants: 0, removedOriginals: 0, removedOther: 1 });
  });
});
