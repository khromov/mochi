import { describe, expect, test } from 'bun:test';
import { imageCacheControl, resolveImageCacheControl, safeOriginalContentType } from './imageEndpoint';

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
