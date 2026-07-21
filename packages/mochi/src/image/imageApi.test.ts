import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getImageUrl, getImageAttrs, getImage } from './imageApi';
import { registerLocalImageAsset } from './localAssetRegistry';
import { resolveImageOptions } from './config';
import { ImageCache } from './imageCache';
import { initExtensions } from '../extensions';

const GLOBAL_CONFIG_KEY = '__mochi_config__';
const GLOBAL_RUNTIME_KEY = '__mochi_image_runtime__';
const GLOBAL_LOCAL_ASSETS_KEY = '__mochi_local_image_assets__';

function installConfig(options: Record<string, unknown> = {}): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options,
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

const dirs: string[] = [];

// Installs the image runtime directly (bypassing getImageRuntime()'s lazy
// getMochiConfig() read), mirroring how the framework pins a shared runtime on
// globalThis. Returns the cache so tests can pre-seed the shared original.
function installRuntime(imageOptions: Record<string, unknown> = {}): ImageCache {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-imgapi-'));
  dirs.push(dir);
  const resolved = resolveImageOptions({ ...imageOptions, cacheDir: dir });
  const cache = new ImageCache({ cacheDir: dir, minTimeToStale: resolved.timeToStale, maxTimeToLive: resolved.timeToEvict, sizes: resolved.sizes });
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY] = { options: resolved, cache };
  return cache;
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY];
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_LOCAL_ASSETS_KEY];
  initExtensions({});
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

const SRC = 'https://example.com/photo.png';

// A tiny valid PNG; decoded and re-encoded at 64×64 to give tests a real source.
const PNG_1x1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
let SOURCE_BYTES: Uint8Array;
beforeAll(async () => {
  SOURCE_BYTES = await new Bun.Image(PNG_1x1).resize(64, 64, { fit: 'fill' }).png().bytes();
});

describe('image:url filter', () => {
  test('getImageUrl returns a bare /_mochi URL when no filter is registered', () => {
    installConfig();
    installRuntime({ sizes: { thumb: { width: 100, height: 100 } } });
    initExtensions({});
    expect(getImageUrl(SRC, 'thumb')).toStartWith('/_mochi/image/photo-thumb.webp?p=');
  });

  test('getImageUrl runs its URL through the image:url filter', () => {
    installConfig();
    installRuntime({ sizes: { thumb: { width: 100, height: 100 } } });
    initExtensions({ filters: { 'image:url': (url) => `https://cdn.example.com${url}` } });
    const url = getImageUrl(SRC, 'thumb');
    expect(url).toStartWith('https://cdn.example.com/_mochi/image/photo-thumb.webp?p=');
  });

  test('the filter receives src/filename and original=false for a named size', () => {
    installConfig();
    installRuntime({ sizes: { thumb: { width: 100, height: 100 } } });
    const seen: { src?: string; filename?: string; original?: boolean } = {};
    initExtensions({
      filters: {
        'image:url': (url, ctx) => {
          Object.assign(seen, ctx);
          return url;
        },
      },
    });
    getImageUrl(SRC, 'thumb');
    expect(seen.src).toBe(SRC);
    expect(seen.filename).toBe('photo-thumb.webp');
    expect(seen.original).toBe(false);
  });

  test('the filter receives original=true when no size is given', () => {
    installConfig();
    installRuntime({});
    const seen: { original?: boolean } = {};
    initExtensions({
      filters: {
        'image:url': (url, ctx) => {
          seen.original = ctx.original;
          return `https://cdn.example.com${url}`;
        },
      },
    });
    const url = getImageUrl(SRC);
    expect(seen.original).toBe(true);
    expect(url).toStartWith('https://cdn.example.com/_mochi/image/photo-original.png?p=');
  });
});

describe('image.enabled = false', () => {
  test('getImageUrl falls back to the raw source URL instead of a dead endpoint', () => {
    installConfig();
    installRuntime({ enabled: false, sizes: { thumb: { width: 100 } } });
    initExtensions({});
    expect(getImageUrl(SRC, 'thumb')).toBe(SRC);
    expect(getImageUrl(SRC)).toBe(SRC);
  });
});

describe('unknown size name', () => {
  test('getImageUrl still yields a usable (original) URL, not a throw', () => {
    installConfig();
    installRuntime({ sizes: { thumb: { width: 100 } } });
    initExtensions({});
    const url = getImageUrl(SRC, 'does-not-exist');
    expect(url).toStartWith('/_mochi/image/photo-original.png?p=');
  });

  test('getImageAttrs degrades to undefined width/height', () => {
    installConfig();
    installRuntime({});
    initExtensions({});
    const attrs = getImageAttrs(SRC, 'does-not-exist');
    expect(attrs.width).toBeUndefined();
    expect(attrs.height).toBeUndefined();
    expect(attrs.url).toStartWith('/_mochi/image/');
  });
});

describe('getImageAttrs', () => {
  test('returns the url plus the size declared width/height', () => {
    installConfig();
    installRuntime({ sizes: { thumb: { width: 150, height: 80 } } });
    initExtensions({});
    const attrs = getImageAttrs(SRC, 'thumb');
    expect(attrs.width).toBe(150);
    expect(attrs.height).toBe(80);
    expect(attrs.url).toStartWith('/_mochi/image/photo-thumb.webp?p=');
  });
});

describe('getImage', () => {
  test('returns transformed bytes + metadata for a real named size', async () => {
    installConfig();
    const cache = installRuntime({ sizes: { thumb: { width: 20, height: 20, format: 'webp' } } });
    await cache.getOriginal(SRC, async () => ({ bytes: SOURCE_BYTES, contentType: 'image/png' }));

    const result = await getImage(SRC, 'thumb');
    expect(result.format).toBe('webp');
    expect(result.contentType).toBe('image/webp');
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  test('an unknown/omitted size returns the original bytes', async () => {
    installConfig();
    const cache = installRuntime({});
    await cache.getOriginal(SRC, async () => ({ bytes: SOURCE_BYTES, contentType: 'image/png' }));

    const result = await getImage(SRC);
    expect(result.contentType).toBe('image/png');
    expect(Array.from(result.bytes)).toEqual(Array.from(SOURCE_BYTES));
  });
});

describe('locally-imported image src (disk-backed)', () => {
  // Register a real on-disk asset so getImage/getImageUrl transform it via the
  // fetchImageSource local branch instead of a network fetch.
  function installLocalAsset(): string {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-imgapi-local-'));
    dirs.push(dir);
    const diskPath = join(dir, 'hero.png');
    writeFileSync(diskPath, SOURCE_BYTES);
    const url = '/_mochi/asset/hero-deadbeef.png';
    registerLocalImageAsset(url, { diskPath, contentType: 'image/png' });
    return url;
  }

  test('getImageUrl mints a normal signed URL for a local src', () => {
    installConfig();
    installRuntime({ sizes: { thumb: { width: 20, height: 20 } } });
    initExtensions({});
    const src = installLocalAsset();
    expect(getImageUrl(src, 'thumb')).toStartWith('/_mochi/image/hero-deadbeef-thumb.webp?p=');
  });

  test('getImage transforms a local src by reading it from disk', async () => {
    installConfig();
    installRuntime({ sizes: { thumb: { width: 20, height: 20, format: 'webp' } } });
    initExtensions({});
    const src = installLocalAsset();
    const result = await getImage(src, 'thumb');
    expect(result.format).toBe('webp');
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  test('getImage with no size returns the original disk bytes', async () => {
    installConfig();
    installRuntime({});
    initExtensions({});
    const src = installLocalAsset();
    const result = await getImage(src);
    expect(result.contentType).toBe('image/png');
    expect(Array.from(result.bytes)).toEqual(Array.from(SOURCE_BYTES));
  });
});
