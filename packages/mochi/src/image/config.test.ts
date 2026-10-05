import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryStorage } from '../cache/cache-storage';
import { getImageRuntime, getSize, reloadImageOptions, resolveImageOptions } from './config';
import { ImageCache, variantId } from './imageCache';
import type { MochiImageOptions } from './types';

const BASE = { width: 100, height: 80 };

function sizesOf(sizes: Record<string, unknown>) {
  return resolveImageOptions({ sizes: sizes as never }).sizes;
}

describe('resolveImageOptions size validation (startup fail-fast)', () => {
  test('resolves a size against the defaults and stamps a config hash', () => {
    const sizes = sizesOf({ thumb: BASE });
    expect(sizes.thumb).toMatchObject({ name: 'thumb', width: 100, height: 80, fit: 'inside', format: 'webp', quality: 80 });
    expect(sizes.thumb!.configHash).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  test.each([
    ['zero width', { width: 0 }],
    ['negative height', { height: -5 }],
    ['NaN width', { width: NaN }],
    ['Infinity height', { height: Infinity }],
  ])('throws on %s', (_label, size) => {
    expect(() => sizesOf({ bad: size })).toThrow(/must be a positive number/);
  });

  test('throws on a non-finite quality', () => {
    expect(() => sizesOf({ bad: { ...BASE, quality: NaN } })).toThrow(/quality must be a finite number/);
    expect(() => sizesOf({ bad: { ...BASE, quality: Infinity } })).toThrow(/quality must be a finite number/);
  });

  test('clamps quality into 1-100', () => {
    expect(sizesOf({ a: { ...BASE, quality: 0.2 } }).a!.quality).toBe(1);
    expect(sizesOf({ a: { ...BASE, quality: 250 } }).a!.quality).toBe(100);
  });

  test('throws on a non-finite rotate', () => {
    expect(() => sizesOf({ bad: { ...BASE, rotate: NaN } })).toThrow(/rotate must be a finite number/);
  });

  test('throws on a format outside outputFormats', () => {
    expect(() => resolveImageOptions({ outputFormats: ['webp'], sizes: { bad: { ...BASE, format: 'png' } } })).toThrow(/not in outputFormats/);
  });
});

describe('config hash', () => {
  test('is stable across runs for the same config', () => {
    expect(sizesOf({ a: BASE }).a!.configHash).toBe(sizesOf({ a: BASE }).a!.configHash);
  });

  test('two sizes with identical config share a hash (shared cache entry)', () => {
    const sizes = sizesOf({ a: BASE, b: BASE });
    expect(sizes.a!.configHash).toBe(sizes.b!.configHash);
  });

  test('redefining a byte-affecting field changes the hash (cache/ETag bust)', () => {
    const before = sizesOf({ a: BASE }).a!.configHash;
    expect(sizesOf({ a: { ...BASE, width: 101 } }).a!.configHash).not.toBe(before);
    expect(sizesOf({ a: { ...BASE, quality: 70 } }).a!.configHash).not.toBe(before);
    expect(sizesOf({ a: { ...BASE, format: 'jpeg' } }).a!.configHash).not.toBe(before);
  });

  test('is insensitive to modulate key order (canonicalized)', () => {
    const ab = sizesOf({ a: { ...BASE, modulate: { saturation: 0, brightness: 1.2 } } }).a!.configHash;
    const ba = sizesOf({ a: { ...BASE, modulate: { brightness: 1.2, saturation: 0 } } }).a!.configHash;
    expect(ab).toBe(ba);
  });
});

describe('getSize', () => {
  test('returns the resolved size for a known name and undefined otherwise', () => {
    const options = resolveImageOptions({ sizes: { thumb: BASE } });
    expect(getSize('thumb', options)).toMatchObject({ name: 'thumb', width: 100, height: 80, format: 'webp', quality: 80 });
    expect(getSize('nope', options)).toBeUndefined();
    expect(getSize(undefined, options)).toBeUndefined();
  });

  test('never resolves prototype-chain names like toString/constructor', () => {
    const options = resolveImageOptions({ sizes: { thumb: BASE } });
    for (const name of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(getSize(name, options)).toBeUndefined();
    }
    // Even against a plain-object sizes map (user-constructed options).
    const plain = { ...options, sizes: { ...options.sizes } };
    expect(getSize('toString', plain)).toBeUndefined();
  });
});

describe('reloadImageOptions (dev entry reload)', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const RUNTIME_KEY = '__mochi_image_runtime__';
  const SRC = 'https://example.com/photo.png';

  function pinRuntime(opts: MochiImageOptions): { options: ReturnType<typeof resolveImageOptions>; cache: ImageCache } {
    const options = resolveImageOptions(opts);
    const cache = new ImageCache({
      cacheDir: options.cacheDir,
      minTimeToStale: options.timeToStale,
      maxTimeToLive: options.timeToEvict,
      sizes: options.sizes,
      storage: new MemoryStorage(),
    });
    g[RUNTIME_KEY] = { options, cache };
    return { options, cache };
  }

  afterEach(() => {
    (g[RUNTIME_KEY] as { cache: ImageCache } | undefined)?.cache.dispose();
    delete g[RUNTIME_KEY];
  });

  test('applies new sizes and allowed hosts to the live runtime, keeping its cache', () => {
    const { cache } = pinRuntime({ allowedHosts: ['i.ytimg.com'], sizes: {} });
    expect(reloadImageOptions({ allowedHosts: ['i.ytimg.com', '*.bsky.app'], sizes: { avatar: { width: 80, height: 80, fit: 'fill' } } })).toEqual([]);
    const runtime = getImageRuntime();
    expect(runtime.cache).toBe(cache);
    expect(runtime.options.allowedHosts).toEqual(['i.ytimg.com', '*.bsky.app']);
    expect(getSize('avatar', runtime.options)).toMatchObject({ width: 80, height: 80, fit: 'fill' });
  });

  test('a hard invalidation cascades to the variants of a size the reload added', async () => {
    const { cache } = pinRuntime({ sizes: {} });
    reloadImageOptions({ sizes: { avatar: BASE } });
    const avatar = getSize('avatar', getImageRuntime().options)!;
    const { entry } = await cache.getOriginal(SRC, async () => ({ bytes: new Uint8Array([1]), contentType: 'image/png' }));
    await cache.getVariant(SRC, variantId(SRC, avatar.configHash), async () => ({
      bytes: new Uint8Array([2]),
      contentType: 'image/webp',
      width: 100,
      height: 80,
      format: 'webp',
      originalCreatedAt: entry.meta.createdAt,
    }));
    expect(await cache.keys()).toHaveLength(2);

    await cache.invalidateOriginal(SRC, true);
    expect(await cache.keys()).toEqual([]);
  });

  test('reports changed boot-only fields and keeps their boot values', () => {
    pinRuntime({ cacheDir: './a', timeToStale: 1_000, sizes: {} });
    expect(reloadImageOptions({ enabled: false, cacheDir: './b', timeToStale: 2_000, sizes: { avatar: BASE } })).toEqual(['enabled', 'cacheDir', 'timeToStale']);
    const { options } = getImageRuntime();
    expect(options).toMatchObject({ enabled: true, cacheDir: './a', timeToStale: 1_000 });
    expect(getSize('avatar', options)).toBeDefined();
  });

  test('a new storage instance of the same class is not a change, a different backend is', () => {
    pinRuntime({ storage: new MemoryStorage() });
    expect(reloadImageOptions({ storage: new MemoryStorage() })).toEqual([]);
    expect(reloadImageOptions({})).toEqual(['storage']);
  });

  test('an invalid size throws and leaves the runtime untouched', () => {
    const { options } = pinRuntime({ sizes: { thumb: BASE } });
    expect(() => reloadImageOptions({ sizes: { thumb: { width: 0 } } })).toThrow(/must be a positive number/);
    expect(getImageRuntime().options).toBe(options);
  });
});
