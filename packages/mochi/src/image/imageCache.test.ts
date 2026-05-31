import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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
  return { src: 'https://example.com/a.png', w: 100, fit: 'inside', fmt: 'webp', q: 80, ao: true, ts: 60_000, te: 86_400_000, ...over };
}

function regen(tag: string): () => Promise<RegenResult> {
  return async () => ({ bytes: new TextEncoder().encode(tag), contentType: 'image/webp', width: 100, height: 100, format: 'webp' });
}

describe('ImageCache', () => {
  test('miss regenerates and writes; subsequent read is fresh without regen', async () => {
    const cache = new ImageCache(tmp());
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

  test('serves stale and triggers background revalidation', async () => {
    const cache = new ImageCache(tmp());
    await cache.get(req({ ts: 0, te: 86_400_000 }), regen('v1'));
    let revalidated = 0;
    const result = await cache.get(req({ ts: 0, te: 86_400_000 }), async () => {
      revalidated++;
      return { bytes: new TextEncoder().encode('v2'), contentType: 'image/webp', width: 100, height: 100, format: 'webp' };
    });
    expect(result.status).toBe('stale');
    expect(new TextDecoder().decode(result.entry.bytes)).toBe('v1'); // stale value served immediately
    await new Promise((r) => setTimeout(r, 20));
    expect(revalidated).toBe(1); // background revalidation ran
  });

  test('regenerates after evict', async () => {
    const cache = new ImageCache(tmp());
    let calls = 0;
    const fn = async (): Promise<RegenResult> => {
      calls++;
      return { bytes: new Uint8Array([calls]), contentType: 'image/webp', width: 100, height: 100, format: 'webp' };
    };
    await cache.get(req({ ts: 0, te: 0 }), fn);
    const second = await cache.get(req({ ts: 0, te: 0 }), fn);
    expect(second.status).toBe('miss');
    expect(calls).toBe(2);
  });

  test('invalidateVariant removes one variant; invalidateSrc removes all', async () => {
    const cache = new ImageCache(tmp());
    const webp = req({ fmt: 'webp' });
    const png = req({ fmt: 'png' });
    await cache.get(webp, regen('w'));
    await cache.get(png, regen('p'));

    await cache.invalidateVariant(webp);
    expect((await cache.get(webp, regen('w2'))).status).toBe('miss'); // gone
    expect((await cache.get(png, regen('p2'))).status).toBe('fresh'); // untouched

    await cache.invalidateSrc(req().src);
    expect((await cache.get(png, regen('p3'))).status).toBe('miss'); // all gone
  });

  test('placeholder round-trips', async () => {
    const cache = new ImageCache(tmp());
    expect(await cache.getPlaceholder('https://example.com/a.png')).toBeNull();
    await cache.setPlaceholder('https://example.com/a.png', 'data:image/png;base64,AAAA');
    expect(await cache.getPlaceholder('https://example.com/a.png')).toBe('data:image/png;base64,AAAA');
  });
});

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
    expect(counter.n).toBe(1); // not re-fetched
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

  test('invalidateSrc drops the original entry', async () => {
    const cache = new ImageCache(tmp());
    await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'));
    await cache.invalidateSrc(SRC);
    expect((await cache.getOriginal(SRC, 60_000, 86_400_000, origFn('o'))).status).toBe('miss');
  });
});
