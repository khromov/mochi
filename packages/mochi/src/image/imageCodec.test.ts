import { describe, expect, test } from 'bun:test';
import { packImageRequest, unpackImageRequest } from './imageCodec';
import { resolveImageOptions } from './config';
import type { ImageFit, ImageFormat, ImageRequest } from './types';

const RESOLVED = resolveImageOptions({});

function req(over: Partial<ImageRequest> = {}): ImageRequest {
  return {
    src: 'https://example.com/a.png',
    width: 200,
    height: 200,
    fit: 'inside',
    format: 'webp',
    quality: 80,
    autoOrient: true,
    timeToStale: 60_000,
    timeToEvict: 86_400_000,
    ...over,
  };
}

function roundTrip(r: ImageRequest): ImageRequest | null {
  return unpackImageRequest(packImageRequest(r, RESOLVED), RESOLVED);
}

describe('packImageRequest + unpackImageRequest', () => {
  test('round-trips a full resize request', () => {
    const r = req({ format: 'jpeg', quality: 60, fit: 'fill', autoOrient: false, withoutEnlargement: true });
    expect(roundTrip(r)).toEqual(r);
  });

  test('omits default fields and refills them on decode', () => {
    const r = req(); // q/ts/te/fmt/ao all equal the resolved defaults
    const packed = packImageRequest(r, RESOLVED);
    // flags(2) + u24 w + u24 h — no q/ts/te fields — u16 srcLen + the URL.
    expect(packed.length).toBe(2 + 3 + 3 + 2 + Buffer.byteLength(r.src));
    expect(unpackImageRequest(packed, RESOLVED)).toEqual(r);
  });

  test('round-trips a request with no width/height', () => {
    const r: ImageRequest = { src: 'https://example.com/a.png', fit: 'inside', format: 'webp', quality: 80, autoOrient: true, timeToStale: 60_000, timeToEvict: 86_400_000 };
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips a full-size original request', () => {
    const r = req({ original: true });
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips overridden timeToStale/timeToEvict', () => {
    const r = req({ timeToStale: 5_000, timeToEvict: 7 * 86_400_000 });
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips every format and fit', () => {
    const formats: ImageFormat[] = ['webp', 'jpeg', 'png', 'avif'];
    const fits: ImageFit[] = ['inside', 'fill'];
    for (const format of formats) {
      for (const fit of fits) {
        const r = req({ format, fit });
        expect(roundTrip(r)).toEqual(r);
      }
    }
  });

  test('round-trips large varint values', () => {
    const r = req({ width: 16_383, height: 2_000_000, timeToStale: 1, timeToEvict: 10 * 86_400_000 });
    expect(roundTrip(r)).toEqual(r);
  });

  test('returns null for a truncated buffer', () => {
    expect(unpackImageRequest(new Uint8Array([0xc0]), RESOLVED)).toBeNull(); // hasW set, no varint bytes
    expect(unpackImageRequest(new Uint8Array([]), RESOLVED)).toBeNull();
  });
});
