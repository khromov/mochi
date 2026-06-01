import { describe, expect, test } from 'bun:test';
import { packImageRequest, unpackImageRequest } from './imageCodec';
import { resolveImageOptions } from './config';
import type { ImageFit, ImageFormat, ImageRequest } from './types';

const RESOLVED = resolveImageOptions({});

function req(over: Partial<ImageRequest> = {}): ImageRequest {
  return { src: 'https://example.com/a.png', w: 200, h: 200, fit: 'inside', fmt: 'webp', q: 80, ao: true, ts: 60_000, te: 86_400_000, ...over };
}

function roundTrip(r: ImageRequest): ImageRequest | null {
  return unpackImageRequest(packImageRequest(r, RESOLVED), RESOLVED);
}

describe('packImageRequest + unpackImageRequest', () => {
  test('round-trips a full resize request', () => {
    const r = req({ fmt: 'jpeg', q: 60, fit: 'fill', ao: false, noUp: true });
    expect(roundTrip(r)).toEqual(r);
  });

  test('omits default fields and refills them on decode', () => {
    const r = req(); // q/ts/te/fmt/ao all equal the resolved defaults
    const packed = packImageRequest(r, RESOLVED);
    // Only control(2) + varint w + varint h — no q/ts/te bytes — plus the URL.
    expect(packed.length).toBe(2 + 2 + 2 + Buffer.byteLength(r.src));
    expect(unpackImageRequest(packed, RESOLVED)).toEqual(r);
  });

  test('round-trips a request with no width/height', () => {
    const r: ImageRequest = { src: 'https://example.com/a.png', fit: 'inside', fmt: 'webp', q: 80, ao: true, ts: 60_000, te: 86_400_000 };
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips a full-size original request', () => {
    const r = req({ orig: true });
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips overridden ts/te', () => {
    const r = req({ ts: 5_000, te: 7 * 86_400_000 });
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips every fmt and fit', () => {
    const fmts: ImageFormat[] = ['webp', 'jpeg', 'png', 'avif'];
    const fits: ImageFit[] = ['inside', 'fill'];
    for (const fmt of fmts) {
      for (const fit of fits) {
        const r = req({ fmt, fit });
        expect(roundTrip(r)).toEqual(r);
      }
    }
  });

  test('round-trips large varint values', () => {
    const r = req({ w: 16_383, h: 2_000_000, ts: 1, te: 10 * 86_400_000 });
    expect(roundTrip(r)).toEqual(r);
  });

  test('returns null for a truncated buffer', () => {
    expect(unpackImageRequest(new Uint8Array([0xc0]), RESOLVED)).toBeNull(); // hasW set, no varint bytes
    expect(unpackImageRequest(new Uint8Array([]), RESOLVED)).toBeNull();
  });
});
