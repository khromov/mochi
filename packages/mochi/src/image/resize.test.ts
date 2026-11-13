import { describe, expect, test } from 'bun:test';
import { computePlaceholder, extForFormat, predictVariantDimensions, probeSourceDimensions, runPipeline } from './resize';
import { resolveImageOptions } from './config';
import { ImageError } from './types';
import type { ImageSize, ResolvedImageOptions } from './types';
import { withExifOrientation } from './__testUtils__/exif';

// 1x1 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// 4x2 red PNG — non-square so a 90° rotate observably swaps the output dimensions
const WIDE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAFElEQVR4nGP8z8BQz4AEmJA5IDYAMCcBgiMx7hUAAAAASUVORK5CYII=', 'base64');

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
    expect(result.width).toBe(3);
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
    // No width/height: a resize would dictate the final dimensions and hide whether rotate ran.
    const { opts, size } = build({ rotate: 90, flip: true, flop: true, modulate: { brightness: 1.1 }, format: 'png' });
    const result = await runPipeline(new Uint8Array(WIDE_PNG), size, opts);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    // The 90° rotate must swap the 4x2 source's dimensions.
    expect(result.width).toBe(2);
    expect(result.height).toBe(4);
  });

  test('withoutEnlargement caps a request bigger than the source', async () => {
    const { opts, size } = build({ width: 1000, height: 1000, fit: 'fill', withoutEnlargement: true });
    const result = await runPipeline(new Uint8Array(PNG), size, opts);
    // The 1x1 source must not be enlarged to 1000x1000.
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
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

describe('predictVariantDimensions', () => {
  const sourceOf = (width: number, height: number) => new Bun.Image(new Uint8Array(PNG)).resize(width, height, { fit: 'fill' }).png().bytes();

  test('a portrait source in a landscape inside box keeps its portrait ratio', () => {
    const { size } = build({ width: 600, height: 400 });
    expect(predictVariantDimensions({ width: 2080, height: 3120, transposed: false }, size)).toEqual({ width: 267, height: 400 });
  });

  test('matches what runPipeline actually encodes for a PNG source', async () => {
    const sources: [number, number][] = [
      [40, 60],
      [301, 199],
      [97, 503],
      [64, 64],
    ];
    const boxes: [number | undefined, number | undefined][] = [
      [51, undefined],
      [13, undefined],
      [undefined, 9],
      [600, 400],
      [50, 9],
      [400, 50],
      [51, 50],
      [30, 700],
    ];
    const mismatches: string[] = [];
    for (const [sw, sh] of sources) {
      const bytes = await sourceOf(sw, sh);
      for (const [width, height] of boxes) {
        for (const fit of ['inside', 'fill'] as const) {
          for (const withoutEnlargement of [false, true]) {
            for (const rotate of [undefined, 90, 180, -90]) {
              const { opts, size } = build({ width, height, fit, withoutEnlargement, rotate, format: 'png' });
              const actual = await runPipeline(bytes, size, opts);
              const predicted = predictVariantDimensions({ width: sw, height: sh, transposed: false }, size);
              if (predicted?.width !== actual.width || predicted?.height !== actual.height) {
                mismatches.push(
                  `${sw}x${sh} ${JSON.stringify({ width, height, fit, withoutEnlargement, rotate })}: predicted ${JSON.stringify(predicted)}, got ${actual.width}x${actual.height}`,
                );
              }
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('follows the EXIF orientation the pipeline applies', async () => {
    const raw = await new Bun.Image(new Uint8Array(PNG)).resize(60, 40, { fit: 'fill' }).jpeg().bytes();
    const rotated = withExifOrientation(raw, 6);
    const source = await probeSourceDimensions(rotated);
    expect(source).toEqual({ width: 40, height: 60, transposed: true });
    for (const autoOrient of [true, false]) {
      const { opts, size } = build({ width: 600, height: 400, format: 'png', autoOrient });
      const actual = await runPipeline(rotated, size, opts);
      expect(predictVariantDimensions(source!, size)).toEqual({ width: actual.width, height: actual.height });
    }
  });

  // A JPEG decoder shrinks on load, so its output can drift a few pixels from the prediction; the aspect ratio must hold.
  test('stays within a pixel-level drift of a JPEG source', async () => {
    const cases: [number, number, number | undefined, number | undefined][] = [
      [2080, 3120, 600, 400],
      [197, 829, 169, 713],
      [289, 469, undefined, 153],
      [1077, 325, 129, undefined],
      [643, 1137, 457, undefined],
    ];
    for (const [sw, sh, width, height] of cases) {
      const bytes = await new Bun.Image(new Uint8Array(PNG)).resize(sw, sh, { fit: 'fill' }).jpeg().bytes();
      const { opts, size } = build({ width, height, format: 'png' });
      const actual = await runPipeline(bytes, size, opts);
      const predicted = predictVariantDimensions({ width: sw, height: sh, transposed: false }, size)!;
      expect(Math.abs(predicted.width - actual.width)).toBeLessThanOrEqual(3);
      expect(Math.abs(predicted.height - actual.height)).toBeLessThanOrEqual(3);
      expect(Math.abs(predicted.width / predicted.height / (actual.width / actual.height) - 1)).toBeLessThan(0.01);
    }
  });

  test('returns null for a rotate that is not a right angle', () => {
    const { size } = build({ width: 100, rotate: 45 });
    expect(predictVariantDimensions({ width: 10, height: 20, transposed: false }, size)).toBeNull();
  });
});
