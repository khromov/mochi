import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageHandler, imageCacheControl, resolveImageCacheControl, safeOriginalContentType } from './imageEndpoint';
import { getImageUrl } from './imageApi';
import { resolveImageOptions } from './config';
import { ImageCache } from './imageCache';
import { initExtensions } from '../extensions';

describe('imageCacheControl', () => {
  test('derives max-age (s) from time-to-stale and SWR from the rest of the evict window', () => {
    // 4 h stale, 1 day evict → 14400s fresh, 72000s stale-while-revalidate.
    expect(imageCacheControl(14_400_000, 86_400_000)).toBe('public, max-age=14400, stale-while-revalidate=72000');
  });

  test('omits stale-while-revalidate when evict equals stale', () => {
    expect(imageCacheControl(60_000, 60_000)).toBe('public, max-age=60');
  });

  test('clamps a non-positive SWR window away rather than emitting a negative directive', () => {
    expect(imageCacheControl(86_400_000, 14_400_000)).toBe('public, max-age=86400');
  });

  test('floors sub-second windows to whole seconds', () => {
    expect(imageCacheControl(1_500, 2_900)).toBe('public, max-age=1, stale-while-revalidate=1');
  });
});

describe('resolveImageCacheControl (per-window TTL)', () => {
  test('a per-request TTL drives max-age, not the resolved default', () => {
    // 60s stale / 120s evict window; the browser policy must reflect that, not some other default.
    expect(resolveImageCacheControl(60_000, 120_000, false)).toBe('public, max-age=60, stale-while-revalidate=60');
  });

  test('the resolved default window produces the expected directive', () => {
    expect(resolveImageCacheControl(14_400_000, 86_400_000, false)).toBe('public, max-age=14400, stale-while-revalidate=72000');
  });

  test('omits Cache-Control entirely in development', () => {
    expect(resolveImageCacheControl(60_000, 120_000, true)).toBeUndefined();
  });
});

describe('safeOriginalContentType', () => {
  test('serves raster image types inline, verbatim', () => {
    for (const ct of ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']) {
      expect(safeOriginalContentType(ct)).toEqual({ contentType: ct, attachment: false });
    }
  });

  test('forces SVG to a non-rendering download (the sharpest XSS edge)', () => {
    expect(safeOriginalContentType('image/svg+xml')).toEqual({ contentType: 'application/octet-stream', attachment: true });
  });

  test('forces HTML and other non-image types to a download', () => {
    expect(safeOriginalContentType('text/html')).toEqual({ contentType: 'application/octet-stream', attachment: true });
    expect(safeOriginalContentType('application/json')).toEqual({ contentType: 'application/octet-stream', attachment: true });
  });

  test('matches on the base type, ignoring charset params and case', () => {
    expect(safeOriginalContentType('IMAGE/PNG; charset=binary')).toEqual({ contentType: 'IMAGE/PNG; charset=binary', attachment: false });
    expect(safeOriginalContentType('image/svg+xml; charset=utf-8')).toEqual({ contentType: 'application/octet-stream', attachment: true });
  });
});

// ——— createImageHandler: mint → HTTP request → response ———

const GLOBAL_CONFIG_KEY = '__mochi_config__';
const GLOBAL_RUNTIME_KEY = '__mochi_image_runtime__';

function installConfig(options: Record<string, unknown> = {}): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options,
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

const dirs: string[] = [];

// Same shape as imageApi.test.ts: pin a runtime directly so mint + handler share
// one cache, and return it so tests can pre-seed the shared original.
function installRuntime(imageOptions: Record<string, unknown> = {}): ImageCache {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-imgep-'));
  dirs.push(dir);
  const resolved = resolveImageOptions({ ...imageOptions, cacheDir: dir });
  const cache = new ImageCache({ cacheDir: dir, minTimeToStale: resolved.timeToStale, maxTimeToLive: resolved.timeToEvict, sizes: resolved.sizes });
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY] = { options: resolved, cache };
  return cache;
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY];
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

const SRC = 'https://example.com/photo.png';

const PNG_1x1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
let SOURCE_BYTES: Uint8Array;
beforeAll(async () => {
  SOURCE_BYTES = await new Bun.Image(PNG_1x1).resize(64, 64, { fit: 'fill' }).png().bytes();
});

async function seedOriginal(cache: ImageCache): Promise<void> {
  await cache.getOriginal(SRC, async () => ({ bytes: SOURCE_BYTES, contentType: 'image/png' }));
}

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${url}`, { headers });
}

describe('createImageHandler', () => {
  test('403 on a missing token', async () => {
    installConfig();
    installRuntime({ sizes: { thumb: { width: 20, height: 20 } } });
    const handler = createImageHandler();
    const res = await handler(request('/_mochi/image/photo-thumb.webp'));
    expect(res.status).toBe(403);
  });

  test('403 when the filename (AAD) does not match the token', async () => {
    installConfig();
    installRuntime({ sizes: { thumb: { width: 20, height: 20 } } });
    initExtensions({});
    const handler = createImageHandler();
    const url = getImageUrl(SRC, 'thumb');
    const tampered = url.replace('photo-thumb.webp', 'other-thumb.webp');
    const res = await handler(request(tampered));
    expect(res.status).toBe(403);
  });

  test('serves a named-size variant with ETag/X-Mochi-Cache, then 304 on If-None-Match', async () => {
    installConfig();
    const cache = installRuntime({ sizes: { thumb: { width: 20, height: 20, format: 'webp' } } });
    initExtensions({});
    await seedOriginal(cache);
    const handler = createImageHandler();
    const url = getImageUrl(SRC, 'thumb');

    const first = await handler(request(url));
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toBe('image/webp');
    expect(first.headers.get('X-Mochi-Cache')).toBe('miss');
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();
    expect((await first.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const second = await handler(request(url));
    expect(second.headers.get('X-Mochi-Cache')).toBe('fresh');
    expect(second.headers.get('ETag')).toBe(etag);

    const conditional = await handler(request(url, { 'if-none-match': etag! }));
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get('ETag')).toBe(etag);
  });

  test('redefining a size changes the variant ETag for an already-minted URL', async () => {
    installConfig();
    const cacheA = installRuntime({ sizes: { thumb: { width: 20, height: 20 } } });
    initExtensions({});
    await seedOriginal(cacheA);
    const url = getImageUrl(SRC, 'thumb');
    const handler = createImageHandler();
    const before = await handler(request(url));
    const etagBefore = before.headers.get('ETag');

    // Same size name, new config → new config hash → new cache entry + ETag.
    const cacheB = installRuntime({ sizes: { thumb: { width: 30, height: 30 } } });
    await seedOriginal(cacheB);
    const after = await handler(request(url));
    expect(after.status).toBe(200);
    expect(after.headers.get('ETag')).toBeTruthy();
    expect(after.headers.get('ETag')).not.toBe(etagBefore);
  });

  test('a size removed since minting serves the full-size original', async () => {
    installConfig();
    const mintCache = installRuntime({ sizes: { thumb: { width: 20, height: 20 } } });
    initExtensions({});
    await seedOriginal(mintCache);
    const url = getImageUrl(SRC, 'thumb');

    const cache = installRuntime({}); // size gone from the config
    await seedOriginal(cache);
    const handler = createImageHandler();
    const res = await handler(request(url));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png'); // original, not webp
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(SOURCE_BYTES));
  });

  test('maps ImageError to its HTTP status (blocked private source → 400)', async () => {
    installConfig();
    installRuntime({ sizes: { thumb: { width: 20, height: 20 } } });
    initExtensions({});
    const handler = createImageHandler();
    // Not seeded, so the endpoint must fetch — and the SSRF guard rejects it.
    const url = getImageUrl('http://127.0.0.1/nope.png', 'thumb');
    const res = await handler(request(url));
    expect(res.status).toBe(400);
  });
});
