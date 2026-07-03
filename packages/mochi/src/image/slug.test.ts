import { describe, expect, test } from 'bun:test';
import { buildImageFilename } from './slug';
import type { ImageRequest } from './types';

function req(over: Partial<ImageRequest> = {}): ImageRequest {
  return { src: 'https://example.com/photos/My-Cat.PNG', fit: 'inside', format: 'webp', quality: 80, autoOrient: true, ...over };
}

describe('buildImageFilename', () => {
  test('derives a slug from the source basename + dimensions', () => {
    expect(buildImageFilename(req({ width: 500, height: 500 }))).toBe('my-cat-500x500.webp');
  });

  test('width-only and height-only labels', () => {
    expect(buildImageFilename(req({ width: 320 }))).toBe('my-cat-320w.webp');
    expect(buildImageFilename(req({ height: 200 }))).toBe('my-cat-200h.webp');
  });

  test('no dimensions → basename only', () => {
    expect(buildImageFilename(req())).toBe('my-cat.webp');
  });

  test('extension follows output format (jpeg → jpg)', () => {
    expect(buildImageFilename(req({ width: 100, height: 100, format: 'jpeg' }))).toBe('my-cat-100x100.jpg');
  });

  test('falls back to "image" when the source has no usable basename', () => {
    expect(buildImageFilename(req({ src: 'https://example.com/', width: 100, height: 100 }))).toBe('image-100x100.webp');
  });
});
