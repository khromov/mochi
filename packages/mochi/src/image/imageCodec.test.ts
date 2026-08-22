import { describe, expect, test } from 'bun:test';
import { packImageRequest, unpackImageRequest } from './imageCodec';
import type { ImageRequest } from './types';

function roundTrip(r: ImageRequest): ImageRequest | null {
  return unpackImageRequest(packImageRequest(r));
}

describe('packImageRequest + unpackImageRequest', () => {
  test('round-trips a request naming a size', () => {
    const r: ImageRequest = { src: 'https://example.com/a.png', size: 'thumbnail' };
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips a request with no size (bare src)', () => {
    const r: ImageRequest = { src: 'https://example.com/a.png' };
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips a full-size original request', () => {
    const r: ImageRequest = { src: 'https://example.com/a.png', original: true };
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips a size name containing unicode/punctuation', () => {
    const r: ImageRequest = { src: 'https://example.com/a.png', size: 'thumb-é/日本語 2' };
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips a long size name and a long src', () => {
    const r: ImageRequest = { src: 'https://example.com/' + 'segment/'.repeat(60) + 'image.png', size: 'x'.repeat(300) };
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips a size name containing bytes that look like control flags', () => {
    // \x01\x02\x04\x08 mirror ORIGINAL/HAS_SIZE/HTTPS_PREFIX/HTTP_PREFIX inside the length-prefixed field.
    const r: ImageRequest = { src: 'https://example.com/a.png?x=1&y=2#frag', size: 'p\x01\x02\x04\x08q' };
    expect(roundTrip(r)).toEqual(r);
  });

  test('round-trips an http:// src', () => {
    const r: ImageRequest = { src: 'http://example.com/a.png', size: 'thumbnail' };
    expect(roundTrip(r)).toEqual(r);
  });

  test('elides the https:// prefix into the control byte instead of literal bytes', () => {
    const r: ImageRequest = { src: 'https://example.com/a.png' };
    // 1 control byte + the src with "https://" (8 bytes) stripped.
    expect(packImageRequest(r).length).toBe(1 + 'example.com/a.png'.length);
  });

  test('round-trips a src with no recognized protocol prefix', () => {
    const r: ImageRequest = { src: 'ftp://example.com/a.png' };
    expect(roundTrip(r)).toEqual(r);
  });

  test('returns null for an empty buffer', () => {
    expect(unpackImageRequest(new Uint8Array([]))).toBeNull();
  });

  test('returns null when the size-name varint length overruns the buffer', () => {
    // control byte with HAS_SIZE set, then a varint claiming a name longer than what follows.
    const HAS_SIZE = 1 << 1;
    expect(unpackImageRequest(new Uint8Array([HAS_SIZE, 100]))).toBeNull();
  });

  test('returns null when a varint itself is truncated (continuation bit set, no next byte)', () => {
    const HAS_SIZE = 1 << 1;
    expect(unpackImageRequest(new Uint8Array([HAS_SIZE, 0x80]))).toBeNull();
  });
});
