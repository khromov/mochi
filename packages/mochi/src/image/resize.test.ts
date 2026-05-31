import { describe, expect, test } from 'bun:test';
import { computePlaceholder, extForFormat, mimeForFormat, resizeImage } from './resize';
import { ImageError } from './types';
import type { ResolvedImageOptions } from './types';
import type { ImageRequest } from './types';

// 1x1 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const opts: ResolvedImageOptions = {
  enabled: true,
  cacheDir: '/tmp/unused',
  defaultFormat: 'webp',
  defaultQuality: 80,
  outputFormats: ['webp', 'jpeg', 'png', 'avif'],
  inputFormats: ['jpeg', 'png', 'webp', 'avif', 'gif'],
  maxPixels: 50_000_000,
  autoOrient: true,
  allowedHosts: undefined,
  blockPrivateNetworks: true,
  fetchTimeoutMs: 10_000,
  maxResponseBytes: 20 * 1024 * 1024,
  timeToStale: 60_000,
  timeToEvict: 86_400_000,
  compressPayload: true,
};

function req(over: Partial<ImageRequest> = {}): ImageRequest {
  return { src: 'https://example.com/a.png', w: 4, h: 4, fit: 'inside', fmt: 'webp', q: 80, ao: true, ts: 1, te: 1, ...over };
}

describe('resizeImage', () => {
  test('resizes and transcodes to the requested format', async () => {
    const result = await resizeImage(new Uint8Array(PNG), req({ fmt: 'webp' }), opts);
    expect(result.contentType).toBe('image/webp');
    expect(result.format).toBe('webp');
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  test('derives width from aspect ratio for height-only requests', async () => {
    const result = await resizeImage(new Uint8Array(PNG), req({ w: undefined, h: 3, fmt: 'png' }), opts);
    expect(result.height).toBe(3);
  });

  test('rejects an input format not on the allowlist', async () => {
    await expect(resizeImage(new Uint8Array(PNG), req(), { ...opts, inputFormats: ['jpeg'] })).rejects.toMatchObject({
      status: 415,
    });
  });

  test('rejects undecodable bytes', async () => {
    await expect(resizeImage(new TextEncoder().encode('not an image'), req(), opts)).rejects.toBeInstanceOf(ImageError);
  });

  test('computePlaceholder returns a data URL', async () => {
    const dataUrl = await computePlaceholder(new Uint8Array(PNG), opts);
    expect(dataUrl.startsWith('data:image/')).toBe(true);
  });

  test('format helpers', () => {
    expect(mimeForFormat('jpeg')).toBe('image/jpeg');
    expect(extForFormat('jpeg')).toBe('jpg');
    expect(extForFormat('webp')).toBe('webp');
  });
});
