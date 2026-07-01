import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  test('invalidateVariant removes one variant; invalidateSrc removes all', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    const webp = req({ format: 'webp' });
    const png = req({ format: 'png' });
    await cache.get(webp, regen('w'));
    await cache.get(png, regen('p'));

    await cache.invalidateVariant(webp);
    expect((await cache.get(webp, regen('w2'))).status).toBe('miss');
    expect((await cache.get(png, regen('p2'))).status).toBe('fresh');

    await cache.invalidateSrc(SRC);
    expect((await cache.get(png, regen('p3'))).status).toBe('miss');
  });

  test('placeholder round-trips', async () => {
    const cache = new ImageCache(tmp());
    expect(await cache.getPlaceholder('https://example.com/a.png')).toBeNull();
    await cache.setPlaceholder('https://example.com/a.png', 'data:image/png;base64,AAAA');
    expect(await cache.getPlaceholder('https://example.com/a.png')).toBe('data:image/png;base64,AAAA');
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

    await cache.invalidateVariantById(SRC, 'pipe123', 'bin');
    expect((await cache.getVariant(SRC, 'pipe123', 'bin', fn)).status).toBe('miss');
    expect(calls).toBe(2);
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

  test('invalidateSrc drops the original entry', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    await cache.invalidateSrc(SRC);
    expect((await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'))).status).toBe('miss');
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

  test('preserves the placeholder and keeps the dir', async () => {
    const dir = tmp();
    const cache = new ImageCache(dir);
    await cache.setPlaceholder(SRC, 'data:image/png;base64,AAAA');
    await cache.getOriginal(SRC, 0, 0, origFn('o')); // immediately evicted
    await cache.get(req(), regen('v'));

    const swept = await cache.sweep(Date.now() + 1000);
    expect(swept.removedOriginals).toBe(1);
    expect(swept.removedVariants).toBe(1);
    expect(await cache.getPlaceholder(SRC)).toBe('data:image/png;base64,AAAA');
    expect(existsSync(join(dir, srcHash(SRC)))).toBe(true);
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
