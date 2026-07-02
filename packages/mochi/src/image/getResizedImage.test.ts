import { afterEach, describe, expect, test } from 'bun:test';
import { getResizedImage, getImage } from './getResizedImage';
import { initExtensions } from '../extensions';

const GLOBAL_CONFIG_KEY = '__mochi_config__';
const GLOBAL_RUNTIME_KEY = '__mochi_image_runtime__';

function installConfig(options: Record<string, unknown> = {}) {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options,
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY];
  initExtensions({});
});

describe('image:url filter', () => {
  test('getResizedImage returns the bare /_mochi URL when no filter is registered', () => {
    installConfig();
    initExtensions({});
    expect(getResizedImage('https://example.com/photo.jpg', { width: 500, height: 500 })).toStartWith('/_mochi/image/photo-500x500.webp?p=');
  });

  test('getResizedImage runs its URL through the image:url filter', () => {
    installConfig();
    initExtensions({ filters: { 'image:url': (url) => `https://cdn.example.com${url}` } });
    const url = getResizedImage('https://example.com/photo.jpg', { width: 500, height: 500 });
    expect(url).toStartWith('https://cdn.example.com/_mochi/image/photo-500x500.webp?p=');
  });

  test('the filter receives src/filename and original=false for resized variants', () => {
    installConfig();
    const seen: { src?: string; filename?: string; original?: boolean } = {};
    initExtensions({
      filters: {
        'image:url': (url, ctx) => {
          Object.assign(seen, ctx);
          return url;
        },
      },
    });
    getResizedImage('https://example.com/photo.jpg', { width: 500, height: 500 });
    expect(seen.src).toBe('https://example.com/photo.jpg');
    expect(seen.filename).toBe('photo-500x500.webp');
    expect(seen.original).toBe(false);
  });

  test('getImage runs through the same filter with original=true', () => {
    installConfig();
    const seen: { original?: boolean } = {};
    initExtensions({
      filters: {
        'image:url': (url, ctx) => {
          seen.original = ctx.original;
          return `https://cdn.example.com${url}`;
        },
      },
    });
    const url = getImage('https://example.com/photo.jpg');
    expect(seen.original).toBe(true);
    expect(url).toStartWith('https://cdn.example.com/_mochi/image/photo-original.jpg?p=');
  });
});

describe('option validation', () => {
  // The binary codec's varint would silently mangle these (-5 → 123, NaN → 0),
  // so they must throw at mint time.
  test('rejects negative, zero, and NaN dimensions', () => {
    installConfig();
    initExtensions({});
    expect(() => getResizedImage('https://example.com/photo.jpg', { width: -5 })).toThrow(/width/);
    expect(() => getResizedImage('https://example.com/photo.jpg', { height: 0 })).toThrow(/height/);
    expect(() => getResizedImage('https://example.com/photo.jpg', { width: Number.NaN })).toThrow(/width/);
  });

  test('rounds fractional dimensions', () => {
    installConfig();
    initExtensions({});
    expect(getResizedImage('https://example.com/photo.jpg', { width: 333.4 })).toStartWith('/_mochi/image/photo-333w.webp?p=');
  });

  test('rejects negative TTLs on getImage', () => {
    installConfig();
    initExtensions({});
    expect(() => getImage('https://example.com/photo.jpg', { timeToStale: -1 })).toThrow(/timeToStale/);
  });
});

describe('image.enabled = false', () => {
  test('minting falls back to the raw source URL instead of a dead endpoint', () => {
    installConfig({ image: { enabled: false } });
    initExtensions({});
    expect(getResizedImage('https://example.com/photo.jpg', { width: 500 })).toBe('https://example.com/photo.jpg');
    expect(getImage('https://example.com/photo.jpg')).toBe('https://example.com/photo.jpg');
  });
});
