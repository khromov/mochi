import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImageCache } from './imageCache';
import type { RegenResult } from './imageCache';
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
