import { describe, expect, test } from 'bun:test';
import { buildImageFilename, buildOriginalFilename } from './slug';
import { resolveImageOptions } from './config';
import type { ImageSize, ResolvedImageSize } from './types';

function size(name: string, def: ImageSize = {}): ResolvedImageSize {
  return resolveImageOptions({ sizes: { [name]: def } }).sizes[name]!;
}

describe('buildImageFilename', () => {
  test('derives a slug from the source basename + the size name', () => {
    const p = size('thumbnail', { width: 500, height: 500 });
    expect(buildImageFilename('https://example.com/photos/My-Cat.PNG', p)).toBe('my-cat-thumbnail.webp');
  });

  test('the size name is slugified too', () => {
    const p = size('Hero Banner!!', {});
    expect(buildImageFilename('https://example.com/photos/My-Cat.PNG', p)).toBe('my-cat-hero-banner.webp');
  });

  test('extension follows the size output format (jpeg -> jpg)', () => {
    const p = size('thumb', { format: 'jpeg' });
    expect(buildImageFilename('https://example.com/photos/My-Cat.PNG', p)).toBe('my-cat-thumb.jpg');
  });

  test('every output format maps to the expected extension', () => {
    expect(buildImageFilename('https://example.com/a.png', size('p', { format: 'webp' }))).toEndWith('.webp');
    expect(buildImageFilename('https://example.com/a.png', size('p', { format: 'png' }))).toEndWith('.png');
    expect(buildImageFilename('https://example.com/a.png', size('p', { format: 'avif' }))).toEndWith('.avif');
  });

  test('falls back to "image" when the source has no usable basename', () => {
    const p = size('thumb', {});
    expect(buildImageFilename('https://example.com/', p)).toBe('image-thumb.webp');
  });
});

describe('buildOriginalFilename', () => {
  test('derives a slug from the source basename, keeping the source extension', () => {
    expect(buildOriginalFilename('https://example.com/photos/My-Cat.PNG')).toBe('my-cat-original.png');
  });

  test('falls back to "img" when the source has no recognizable extension', () => {
    expect(buildOriginalFilename('https://example.com/photos/my-cat')).toBe('my-cat-original.img');
  });

  test('falls back to "image" when the source has no usable basename', () => {
    expect(buildOriginalFilename('https://example.com/')).toBe('image-original.img');
  });
});
