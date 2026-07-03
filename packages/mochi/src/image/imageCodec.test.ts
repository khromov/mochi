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
    ...over,
  };
}

function roundTrip(r: ImageRequest): ImageRequest | null {
  return unpackImageRequest(packImageRequest(r), RESOLVED);
}

describe('packImageRequest + unpackImageRequest', () => {
  test('round-trips a full resize request', () => {
    const r = req({ format: 'jpeg', quality: 60, fit: 'fill', autoOrient: false, withoutEnlargement: true });
    expect(roundTrip(r)).toEqual(r);
  });

  test('always encodes quality; omits only truly-absent optional fields', () => {
    const r = req(); // quality equals the default, but is still encoded; timeToStale/timeToEvict absent
    const packed = packImageRequest(r);
    // 2 control bytes + width varint(2) + height varint(2) + quality(1) — no timeToStale/timeToEvict — then the trailing utf-8 src.
    expect(packed.length).toBe(2 + 2 + 2 + 1 + Buffer.byteLength(r.src));
    expect(unpackImageRequest(packed, RESOLVED)).toEqual(r);
  });

  test('a token is self-describing: a later config default change does not reinterpret it', () => {
    // Mint with quality equal to config A's default and TTLs equal to A's defaults.
    const configA = resolveImageOptions({ defaultQuality: 80, timeToStale: 111, timeToEvict: 222 });
    const r = req({ quality: configA.defaultQuality, timeToStale: configA.timeToStale, timeToEvict: configA.timeToEvict });
    const packed = packImageRequest(r);
    // Decode under a DIFFERENT config: the decoded values must still be config A's,
    // not config B's defaults.
    const configB = resolveImageOptions({ defaultQuality: 50, timeToStale: 999, timeToEvict: 1_000 });
    const decoded = unpackImageRequest(packed, configB);
    expect(decoded?.quality).toBe(80);
    expect(decoded?.timeToStale).toBe(111);
    expect(decoded?.timeToEvict).toBe(222);
  });

  test('throws on an output format the 2-bit codec field cannot represent', () => {
    expect(() => packImageRequest(req({ format: 'gif' as ImageFormat }))).toThrow();
  });

  test('round-trips a request with no width/height', () => {
    const r: ImageRequest = { src: 'https://example.com/a.png', fit: 'inside', format: 'webp', quality: 80, autoOrient: true };
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
    expect(unpackImageRequest(new Uint8Array([]), RESOLVED)).toBeNull(); // shorter than the 2 control bytes
    expect(unpackImageRequest(new Uint8Array([0x40]), RESOLVED)).toBeNull(); // hasWidth set but only 1 byte
    expect(unpackImageRequest(new Uint8Array([0x40, 0x00]), RESOLVED)).toBeNull(); // hasWidth set, no width varint follows
  });
});
