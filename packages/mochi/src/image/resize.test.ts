import { describe, expect, test } from 'bun:test';
import { computePlaceholder, extForFormat, runPipeline } from './resize';
import { resolveImageOptions } from './config';
import { ImageError } from './types';
import type { ImageSize, ResolvedImageOptions } from './types';

// 1x1 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function build(def: ImageSize, overrides: Record<string, unknown> = {}): { opts: ResolvedImageOptions; size: ResolvedImageOptions['sizes'][string] } {
  const resolved = resolveImageOptions({ sizes: { p: def }, ...overrides });
  return { opts: resolved, size: resolved.sizes.p! };
}

describe('runPipeline', () => {
  test('resizes and transcodes to the requested format', async () => {
    const { opts, size } = build({ width: 4, height: 4, format: 'webp' });
    const result = await runPipeline(new Uint8Array(PNG), size, opts);
    expect(result.contentType).toBe('image/webp');
    expect(result.format).toBe('webp');
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  test('derives width from aspect ratio for height-only sizes', async () => {
    const { opts, size } = build({ height: 3, format: 'png' });
    const result = await runPipeline(new Uint8Array(PNG), size, opts);
    expect(result.height).toBe(3);
  });

  test('rejects an input format not on the allowlist', async () => {
    const { opts, size } = build({ width: 4, height: 4 });
    await expect(runPipeline(new Uint8Array(PNG), size, { ...opts, inputFormats: ['jpeg'] })).rejects.toMatchObject({
      status: 415,
    });
  });

  test('rejects undecodable bytes', async () => {
    const { opts, size } = build({ width: 4, height: 4 });
    await expect(runPipeline(new TextEncoder().encode('not an image'), size, opts)).rejects.toBeInstanceOf(ImageError);
  });

  test('applies rotate/flip/flop/modulate without throwing', async () => {
    const { opts, size } = build({ width: 4, height: 4, rotate: 90, flip: true, flop: true, modulate: { brightness: 1.1 } });
    const result = await runPipeline(new Uint8Array(PNG), size, opts);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  test('withoutEnlargement caps a request bigger than the source', async () => {
    const { opts, size } = build({ width: 1000, height: 1000, fit: 'fill', withoutEnlargement: true });
    const result = await runPipeline(new Uint8Array(PNG), size, opts);
    // The 1x1 source must not be enlarged to 1000x1000.
    expect(result.width).toBeLessThan(1000);
  });

  test('computePlaceholder returns a data URL', async () => {
    const { opts } = build({ width: 4, height: 4 });
    const dataUrl = await computePlaceholder(new Uint8Array(PNG), opts);
    expect(dataUrl.startsWith('data:image/')).toBe(true);
  });

  test('format helpers', () => {
    expect(extForFormat('jpeg')).toBe('jpg');
    expect(extForFormat('webp')).toBe('webp');
    expect(extForFormat('png')).toBe('png');
    expect(extForFormat('avif')).toBe('avif');
  });
});
