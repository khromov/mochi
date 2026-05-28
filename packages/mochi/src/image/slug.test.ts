import { describe, expect, test } from 'bun:test';
import { buildImageFilename } from './slug';
import type { ImageRequest } from './types';

function req(over: Partial<ImageRequest> = {}): ImageRequest {
  return { src: 'https://example.com/photos/My-Cat.PNG', fit: 'inside', fmt: 'webp', q: 80, ao: true, ts: 1, te: 1, ...over };
}

describe('buildImageFilename', () => {
  test('derives a slug from the source basename + dimensions', () => {
    expect(buildImageFilename(req({ w: 500, h: 500 }))).toBe('my-cat-500x500.webp');
  });

  test('width-only and height-only labels', () => {
    expect(buildImageFilename(req({ w: 320 }))).toBe('my-cat-320w.webp');
    expect(buildImageFilename(req({ h: 200 }))).toBe('my-cat-200h.webp');
  });

  test('no dimensions → basename only', () => {
    expect(buildImageFilename(req())).toBe('my-cat.webp');
  });

  test('extension follows output format (jpeg → jpg)', () => {
    expect(buildImageFilename(req({ w: 100, h: 100, fmt: 'jpeg' }))).toBe('my-cat-100x100.jpg');
  });

  test('falls back to "image" when the source has no usable basename', () => {
    expect(buildImageFilename(req({ src: 'https://example.com/', w: 100, h: 100 }))).toBe('image-100x100.webp');
  });
});
