import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mochiEvents } from '../events';
import type { MochiImageDeleteEvent, MochiImageStoreEvent } from '../events';
import { ImageCache, srcHash } from './imageCache';
import type { RegenResult, SidecarMeta } from './imageCache';
import type { ImageRequest } from './types';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'mochi-img-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function req(over: Partial<ImageRequest> = {}): ImageRequest {
  return { src: 'https://example.com/a.png', width: 100, fit: 'inside', format: 'webp', quality: 80, autoOrient: true, ...over };
}

function regen(tag: string): () => Promise<RegenResult> {
  return async () => ({ bytes: new TextEncoder().encode(tag), contentType: 'image/webp', width: 100, height: 100, format: 'webp' });
}

const SRC = 'https://example.com/a.png';

function origFn(tag: string, ct: string | null = 'image/jpeg', counter?: { n: number }) {
  return async (): Promise<{ bytes: Uint8Array; contentType: string | null }> => {
    if (counter) {
      counter.n++;
    }
    return { bytes: new TextEncoder().encode(tag), contentType: ct };
  };
}

function readOrigMeta(dir: string, src = SRC): SidecarMeta {
  return JSON.parse(readFileSync(join(dir, srcHash(src), 'original.json'), 'utf-8')) as SidecarMeta;
}

describe('ImageCache variant (lifetime follows the original)', () => {
  test('miss regenerates; subsequent read is fresh while the original is fresh', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    let calls = 0;
    const fn = async (): Promise<RegenResult> => {
      calls++;
      return { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/webp', width: 100, height: 100, format: 'webp' };
    };
    const first = await cache.get(req(), fn);
    expect(first.status).toBe('miss');
    expect(calls).toBe(1);

    const second = await cache.get(req(), fn);
    expect(second.status).toBe('fresh');
    expect(calls).toBe(1);
    expect(Array.from(second.entry.bytes)).toEqual([1, 2, 3]);
  });

  test('inherits the original stale window and revalidates in the background', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 0, 86_400_000, origFn('o')); // original immediately stale
    await cache.get(req(), regen('v1'));
    let revalidated = 0;
    const result = await cache.get(req(), async () => {
      revalidated++;
      return { bytes: new TextEncoder().encode('v2'), contentType: 'image/webp', width: 100, height: 100, format: 'webp' };
    });
    expect(result.status).toBe('stale');
    expect(new TextDecoder().decode(result.entry.bytes)).toBe('v1'); // stale value served immediately
    await new Promise((r) => setTimeout(r, 20));
    expect(revalidated).toBe(1);
  });

  test('misses once the original is past its evict window', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 0, 0, origFn('o')); // original immediately evicted
    let calls = 0;
    const fn = async (): Promise<RegenResult> => {
      calls++;
      return { bytes: new Uint8Array([calls]), contentType: 'image/webp', width: 100, height: 100, format: 'webp' };
    };
    await cache.get(req(), fn);
    const second = await cache.get(req(), fn);
    expect(second.status).toBe('miss');
    expect(calls).toBe(2);
  });

  test('a refreshed original (new generation) serves the variant stale and regenerates', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o1'));
    await cache.get(req(), regen('v1'));
    expect((await cache.get(req(), regen('v1'))).status).toBe('fresh');

    // Evict + re-fetch the original so its createdAt (generation) bumps.
    await cache.getOriginal(SRC, 0, 0, origFn('o2'));
    await new Promise((r) => setTimeout(r, 5));
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o3'));

    let calls = 0;
    const result = await cache.get(req(), async () => {
      calls++;
      return { bytes: new TextEncoder().encode('v2'), contentType: 'image/webp', width: 100, height: 100, format: 'webp' };
    });
    expect(result.status).toBe('stale'); // generation mismatch → stale, not fresh
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
  });

  test('misses once the original entry is removed', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    await cache.get(req(), regen('v1'));
    expect((await cache.get(req(), regen('v1'))).status).toBe('fresh');

    rmSync(join(dir, srcHash(SRC), 'original.json'));
    expect((await cache.get(req(), regen('v2'))).status).toBe('miss');
  });

  test('placeholder round-trips while the original generation matches', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    expect(await cache.getPlaceholder(SRC)).toBeNull();
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', readOrigMeta(dir).createdAt);
    expect(await cache.getPlaceholder(SRC)).toBe('data:image/png;base64,AAAA');
  });

  test('placeholder misses once the original moves to a new generation', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o1'));
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', readOrigMeta(dir).createdAt);
    expect(await cache.getPlaceholder(SRC)).toBe('data:image/png;base64,AAAA');

    // Hard invalidate + re-fetch: the original's createdAt (generation) bumps,
    // so the placeholder computed from the old bytes must not be served.
    await cache.invalidateOriginal(SRC, true);
    await new Promise((r) => setTimeout(r, 5));
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o2'));
    expect(await cache.getPlaceholder(SRC)).toBeNull();
  });

  test('a variant stamped from an older original generation is not served fresh', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    const gen = readOrigMeta(dir).createdAt;

    // The regenerate callback reports bytes derived from an older generation
    // (a background original refresh landed mid-regeneration).
    await cache.getVariant(SRC, 'race1', 'webp', async () => ({
      bytes: new TextEncoder().encode('old-gen'),
      contentType: 'image/webp',
      width: 100,
      height: 100,
      format: 'webp',
      originalCreatedAt: gen - 1,
    }));

    const result = await cache.getVariant(SRC, 'race1', 'webp', regen('v2'));
    expect(result.status).toBe('stale'); // generation mismatch → regenerate, don't serve as fresh
  });

  test('getVariant caches an arbitrary pipeline id and follows the original', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    let calls = 0;
    const fn = async (): Promise<RegenResult> => {
      calls++;
      return { bytes: new Uint8Array([9, 9, 9]), contentType: 'image/webp', width: 5, height: 5, format: 'webp' };
    };

    expect((await cache.getVariant(SRC, 'pipe123', 'bin', fn)).status).toBe('miss');
    const second = await cache.getVariant(SRC, 'pipe123', 'bin', fn);
    expect(second.status).toBe('fresh');
    expect(calls).toBe(1);
    expect(Array.from(second.entry.bytes)).toEqual([9, 9, 9]);
    expect(existsSync(join(dir, srcHash(SRC), 'pipe123.bin'))).toBe(true);
  });
});

describe('ImageCache.readConsistentVariant (torn-read guard)', () => {
  function metaGen(createdAt: number): SidecarMeta {
    return {
      version: 1,
      contentType: 'image/webp',
      etag: 'v',
      width: 1,
      height: 1,
      format: 'webp',
      createdAt,
      staleAt: createdAt + 1_000,
      evictAt: createdAt + 2_000,
      src: SRC,
      originalCreatedAt: createdAt,
    };
  }

  test('never pairs an old sidecar with newer bytes', async () => {
    const cache = new ImageCache(tmp());
    // Simulate a concurrent write: the first sidecar read reports generation 1,
    // but the bytes (and every later sidecar read) are generation 2. The helper
    // must reject the {gen1 meta, gen2 bytes} torn pair and return a consistent one.
    const metaSeq = [metaGen(1), metaGen(2), metaGen(2), metaGen(2), metaGen(2)];
    let i = 0;
    const stub = cache as unknown as {
      readMetaFor: () => Promise<SidecarMeta | null>;
      readBytesFor: () => Promise<Uint8Array | null>;
      readConsistentVariant(src: string, id: string, ext: string): Promise<{ bytes: Uint8Array; meta: SidecarMeta } | null>;
    };
    stub.readMetaFor = async () => metaSeq[i++] ?? metaGen(2);
    stub.readBytesFor = async () => new TextEncoder().encode('gen2');

    const entry = await stub.readConsistentVariant(SRC, 'v', 'webp');
    expect(entry).not.toBeNull();
    expect(entry!.meta.createdAt).toBe(2); // matches the bytes' generation, not the torn gen1
    expect(new TextDecoder().decode(entry!.bytes)).toBe('gen2');
  });
});

describe('ImageCache.getOriginal', () => {
  test('miss regenerates, preserves content-type; subsequent read is fresh', async () => {
    const cache = new ImageCache(tmp());
    const counter = { n: 0 };
    const first = await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('orig', 'image/gif', counter));
    expect(first.status).toBe('miss');
    expect(first.entry.meta.contentType).toBe('image/gif');
    expect(counter.n).toBe(1);

    const second = await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('orig', 'image/gif', counter));
    expect(second.status).toBe('fresh');
    expect(counter.n).toBe(1);
    expect(new TextDecoder().decode(second.entry.bytes)).toBe('orig');
  });

  test('serves stale and triggers background revalidation', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 0, 86_400_000, origFn('v1'));
    const counter = { n: 0 };
    const result = await cache.getOriginal(SRC, 0, 86_400_000, origFn('v2', 'image/jpeg', counter));
    expect(result.status).toBe('stale');
    expect(new TextDecoder().decode(result.entry.bytes)).toBe('v1');
    await new Promise((r) => setTimeout(r, 20));
    expect(counter.n).toBe(1);
  });

  test('regenerates after evict', async () => {
    const cache = new ImageCache(tmp());
    const counter = { n: 0 };
    await cache.getOriginal(SRC, 0, 0, origFn('x', 'image/jpeg', counter));
    const second = await cache.getOriginal(SRC, 0, 0, origFn('x', 'image/jpeg', counter));
    expect(second.status).toBe('miss');
    expect(counter.n).toBe(2);
  });

  test('shortest window wins; a longer window never lengthens it', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    const warm = readOrigMeta(dir);

    // A shorter request shortens the shared entry.
    await cache.getOriginal(SRC, 30_000, 1_000_000, origFn('o'));
    const shortened = readOrigMeta(dir);
    expect(shortened.staleAt).toBeLessThan(warm.staleAt);
    expect(shortened.evictAt).toBeLessThan(warm.evictAt);

    // A later longer request does NOT lengthen it (min, not max).
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    const after = readOrigMeta(dir);
    expect(after.staleAt).toBe(shortened.staleAt);
    expect(after.evictAt).toBe(shortened.evictAt);
  });

  test('fresh read with an unchanged window does not rewrite the sidecar', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    const metaPath = join(dir, srcHash(SRC), 'original.json');
    const mtime = statSync(metaPath).mtimeMs;
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    expect(statSync(metaPath).mtimeMs).toBe(mtime);
  });

  test('coalesces concurrent misses into one fetch', async () => {
    const cache = new ImageCache(tmp());
    let resolve: () => void = () => {};
    const gate = new Promise<void>((r) => (resolve = r));
    let calls = 0;
    const fn = async (): Promise<{ bytes: Uint8Array; contentType: string | null }> => {
      calls++;
      await gate;
      return { bytes: new TextEncoder().encode('x'), contentType: 'image/png' };
    };
    const p1 = cache.getOriginal(SRC, 60_000, 86_400_000, fn);
    const p2 = cache.getOriginal(SRC, 60_000, 86_400_000, fn);
    resolve();
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
  });

  test('original and resize variants coexist for the same src', async () => {
    const cache = new ImageCache(tmp());
    await cache.get(req(), regen('variant'));
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('original'));
    expect(new TextDecoder().decode((await cache.get(req(), regen('x'))).entry.bytes)).toBe('variant');
    expect(new TextDecoder().decode((await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('x'))).entry.bytes)).toBe('original');
  });

  test('reclaims the previous generation bytes when the source content-type changes', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    const srcDir = join(dir, srcHash(SRC));

    await cache.getOriginal(SRC, 0, 0, origFn('jpg-bytes', 'image/jpeg')); // immediately evicted
    expect(existsSync(join(srcDir, 'original.jpg'))).toBe(true);

    // Evicted, so the next read re-fetches — now the origin serves webp.
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('webp-bytes', 'image/webp'));
    expect(existsSync(join(srcDir, 'original.webp'))).toBe(true);
    expect(existsSync(join(srcDir, 'original.jpg'))).toBe(false); // stale-format bytes reclaimed
  });
});

describe('ImageCache.invalidateOriginal', () => {
  test('soft marks the original stale — variants serve stale and revalidate', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    await cache.get(req(), regen('v'));
    expect((await cache.get(req(), regen('v'))).status).toBe('fresh');

    await cache.invalidateOriginal(SRC, false);

    expect((await cache.get(req(), regen('v'))).status).toBe('stale');
    expect((await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'))).status).toBe('stale');
  });

  test('hard marks the original expired — variants miss and re-fetch', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    await cache.get(req(), regen('v'));
    expect((await cache.get(req(), regen('v'))).status).toBe('fresh');

    await cache.invalidateOriginal(SRC, true);

    expect((await cache.get(req(), regen('v'))).status).toBe('miss');
    expect((await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o2'))).status).toBe('miss');
  });

  test('is a no-op when nothing is cached', async () => {
    const cache = new ImageCache(tmp());
    await cache.invalidateOriginal('https://example.com/missing.png', true);
  });

  test('a stale window snapshot cannot resurrect a hard-invalidated entry', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    const snapshot = readOrigMeta(dir); // read before the invalidate lands

    await cache.invalidateOriginal(SRC, true);
    const invalidated = readOrigMeta(dir);

    // Simulates a request that read the sidecar before the invalidate and asks
    // for a shorter-than-snapshot window: it must min against the on-disk
    // (invalidated) values, not extend them from its stale copy.
    await (
      cache as unknown as {
        shortenOriginalWindow(src: string, meta: SidecarMeta, timeToStale: number, timeToEvict: number, now: number): Promise<SidecarMeta>;
      }
    ).shortenOriginalWindow(SRC, snapshot, 30_000, 1_000_000, Date.now());

    const after = readOrigMeta(dir);
    expect(after.staleAt).toBeLessThanOrEqual(invalidated.staleAt);
    expect(after.evictAt).toBeLessThanOrEqual(invalidated.evictAt);
  });

  test('an in-flight background revalidation cannot resurrect a hard invalidation', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));

    // Start a revalidation whose fetch is parked, then hard-invalidate while it's
    // in flight. When the fetch finally resolves, its write must not reset the
    // window that the invalidation expired.
    let resolveFetch!: (v: { bytes: Uint8Array; contentType: string | null }) => void;
    const gate = new Promise<{ bytes: Uint8Array; contentType: string | null }>((res) => {
      resolveFetch = res;
    });
    const revalidate = (
      cache as unknown as {
        revalidateOriginal(src: string, ts: number, te: number, fn: () => Promise<{ bytes: Uint8Array; contentType: string | null }>): Promise<unknown>;
      }
    ).revalidateOriginal(SRC, 60_000, 86_400_000, () => gate);

    await cache.invalidateOriginal(SRC, true);
    const invalidated = readOrigMeta(dir);

    resolveFetch({ bytes: new TextEncoder().encode('late'), contentType: 'image/jpeg' });
    await revalidate;

    const after = readOrigMeta(dir);
    // Still expired (≈ now), NOT reset to a fresh now + 86_400_000 window.
    expect(after.evictAt).toBeLessThanOrEqual(invalidated.evictAt);
    expect(after.evictAt).toBeLessThanOrEqual(Date.now());
  });
});

describe('ImageCache.sweep', () => {
  test('leaves fresh entries untouched', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    await cache.get(req(), regen('v'));

    expect(await cache.sweep(Date.now())).toEqual({ removedVariants: 0, removedOriginals: 0, freedBytes: 0 });
    expect((await cache.get(req(), regen('v'))).status).toBe('fresh');
  });

  test('removes an evicted original and its variants, reclaiming the dir', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    await cache.get(req(), regen('v'));

    const swept = await cache.sweep(Date.now() + 2 * 86_400_000); // jump past the evict window
    expect(swept.removedOriginals).toBe(1);
    expect(swept.removedVariants).toBe(1);
    expect(swept.freedBytes).toBeGreaterThan(0);
    expect(existsSync(join(dir, srcHash(SRC)))).toBe(false);
  });

  test('removes a variant orphaned from a missing original', async () => {
    const cache = new ImageCache(tmp());
    await cache.get(req(), regen('v')); // variant written with no original present

    const swept = await cache.sweep(Date.now());
    expect(swept).toMatchObject({ removedVariants: 1, removedOriginals: 0 });
  });

  test('removes a variant superseded by a newer original generation', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o1'));
    await cache.get(req(), regen('v1')); // tied to the o1 generation

    // Evict + re-fetch so the original's createdAt (generation) bumps.
    await cache.getOriginal(SRC, 0, 0, origFn('o2'));
    await new Promise((r) => setTimeout(r, 5));
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o3'));

    const swept = await cache.sweep(Date.now());
    expect(swept.removedVariants).toBe(1); // old-generation variant
    expect(swept.removedOriginals).toBe(0); // fresh original kept
  });

  test('removes the placeholder with its evicted original so the dir is reclaimed', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 0, 0, origFn('o')); // immediately evicted
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', readOrigMeta(dir).createdAt);
    await cache.get(req(), regen('v'));

    const swept = await cache.sweep(Date.now() + 1000);
    expect(swept.removedOriginals).toBe(1);
    expect(swept.removedVariants).toBe(1);
    expect(await cache.getPlaceholder(SRC)).toBeNull();
    expect(existsSync(join(dir, srcHash(SRC)))).toBe(false);
  });

  test('removes a stray-format original leftover when the original is evicted', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    const srcDir = join(dir, srcHash(SRC));
    await cache.getOriginal(SRC, 0, 0, origFn('o', 'image/jpeg')); // original.jpg, immediately evicted
    writeFileSync(join(srcDir, 'original.png'), 'leftover from a prior format'); // simulate a crash-time orphan

    await cache.sweep(Date.now() + 1000);
    expect(existsSync(join(srcDir, 'original.jpg'))).toBe(false);
    expect(existsSync(join(srcDir, 'original.png'))).toBe(false); // stray sibling reclaimed too
    expect(existsSync(srcDir)).toBe(false); // dir emptied and removed
  });

  test('is a no-op when the cache dir does not exist', async () => {
    const cache = new ImageCache(join(tmp(), 'not-created-yet'));
    expect(await cache.sweep(Date.now())).toEqual({ removedVariants: 0, removedOriginals: 0, freedBytes: 0 });
  });
});

describe('ImageCache lifecycle events', () => {
  const stores: MochiImageStoreEvent[] = [];
  const deletes: MochiImageDeleteEvent[] = [];
  const onStore = (e: MochiImageStoreEvent) => stores.push(e);
  const onDelete = (e: MochiImageDeleteEvent) => deletes.push(e);
  beforeEach(() => {
    stores.length = 0;
    deletes.length = 0;
    mochiEvents.on('image:store', onStore);
    mochiEvents.on('image:delete', onDelete);
  });
  afterEach(() => {
    mochiEvents.off('image:store', onStore);
    mochiEvents.off('image:delete', onDelete);
  });

  test('getOriginal miss emits image:store kind:original', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o', 'image/jpeg'));
    const originals = stores.filter((s) => s.kind === 'original');
    expect(originals).toHaveLength(1);
    expect(originals[0]).toMatchObject({ kind: 'original', src: SRC, contentType: 'image/jpeg', width: 0, height: 0, format: '' });
    expect(originals[0]!.size).toBeGreaterThan(0);
    expect(originals[0]!.path.endsWith('original.jpg')).toBe(true);
  });

  test('variant miss emits image:store kind:variant with dimensions', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    stores.length = 0; // ignore the original store above
    await cache.get(req(), regen('v1'));
    const variants = stores.filter((s) => s.kind === 'variant');
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ kind: 'variant', src: SRC, contentType: 'image/webp', width: 100, height: 100, format: 'webp' });
  });

  test('setPlaceholder emits image:store kind:placeholder', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    stores.length = 0;
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', readOrigMeta(dir).createdAt);
    expect(stores).toHaveLength(1);
    expect(stores[0]).toMatchObject({ kind: 'placeholder', src: SRC, contentType: '', format: '' });
  });

  test('sweep emits image:delete reason:evicted for the original, variant, and placeholder', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.getOriginal(SRC, 0, 0, origFn('o')); // immediately evicted
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA', readOrigMeta(dir).createdAt);
    await cache.get(req(), regen('v'));
    deletes.length = 0;
    await cache.sweep(Date.now() + 1000);
    expect(deletes.map((d) => d.kind).sort()).toEqual(['original', 'placeholder', 'variant']);
    expect(deletes.every((d) => d.reason === 'evicted')).toBe(true);
  });

  test('sweep emits reason:superseded for an old-generation variant', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o1'));
    await cache.get(req(), regen('v1'));
    await cache.getOriginal(SRC, 0, 0, origFn('o2'));
    await new Promise((r) => setTimeout(r, 5));
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o3'));
    deletes.length = 0;
    await cache.sweep(Date.now());
    expect(deletes.find((d) => d.kind === 'variant')?.reason).toBe('superseded');
  });
});
