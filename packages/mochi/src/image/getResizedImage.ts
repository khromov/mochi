import { getImageAssetPrefix, getImageRuntime } from './config';
import { fetchImageSource } from './fetchSource';
import { encryptImageRequest } from './imageCrypto';
import { packImageRequest } from './imageCodec';
import { computePlaceholder } from './resize';
import { buildImageFilename, buildOriginalFilename } from './slug';
import { requestContext } from '../requestContext';
import { applyFilter } from '../extensions';
import { logger } from '../log';
import type { ImageCache, ImageCacheStatus } from './imageCache';
import type { ImageFormat, ImageRequest, InvalidateImageOptions, OriginalImageOptions, ResizeImageOptions, ResolvedImageOptions } from './types';

function clampQuality(q: number): number {
  if (!Number.isFinite(q)) {
    return 80;
  }
  return Math.min(100, Math.max(1, Math.round(q)));
}

function buildRequest(src: string, opts: ResizeImageOptions, resolved: ResolvedImageOptions): ImageRequest {
  let fmt: ImageFormat = opts.format ?? resolved.defaultFormat;
  if (!resolved.outputFormats.includes(fmt)) {
    logger.warn(`Image format "${fmt}" is not in outputFormats; falling back to "${resolved.defaultFormat}".`);
    fmt = resolved.defaultFormat;
  }
  return {
    src,
    width: opts.width,
    height: opts.height,
    fit: opts.fit ?? 'inside',
    withoutEnlargement: opts.withoutEnlargement ? true : undefined,
    format: fmt,
    quality: clampQuality(opts.quality ?? resolved.defaultQuality),
    autoOrient: opts.autoOrient ?? resolved.autoOrient,
    timeToStale: resolved.timeToStale,
    timeToEvict: resolved.timeToEvict,
  };
}

/**
 * Build a signed, cacheable URL for a resized image. Server-side only (it reads
 * the signing secret from the Mochi config). The path is a cosmetic,
 * human-readable filename derived from the source name + dimensions; the
 * authoritative encrypted request travels in the `p` query param (the
 * filename is bound as AAD): `/_mochi/image/my-image-500x500.webp?p=<token>`.
 */
export function getResizedImage(src: string, opts: ResizeImageOptions = {}): string {
  const { options } = getImageRuntime();
  const req = buildRequest(src, opts, options);
  return mintImageUrl(req, buildImageFilename(req), options);
}

// Mint the signed URL and let the `image:url` filter rewrite it (e.g. prepend a
// CDN origin) before it's recorded/returned — so the debug bar logs what the
// caller actually gets.
function mintImageUrl(req: ImageRequest, filename: string, options: ResolvedImageOptions): string {
  const token = encryptImageRequest(req, filename, options, options.compressPayload);
  const raw = `${getImageAssetPrefix()}/image/${filename}?p=${token}`;
  const url = applyFilter('image:url', raw, { src: req.src, filename, original: req.original === true });
  recordForDebugBar(url, filename, req, options);
  return url;
}

function buildOriginalRequest(src: string, opts: OriginalImageOptions, resolved: ResolvedImageOptions): ImageRequest {
  // fit/format/quality/autoOrient satisfy the non-optional fields but are ignored for originals.
  return {
    src,
    fit: 'inside',
    format: resolved.defaultFormat,
    quality: resolved.defaultQuality,
    autoOrient: resolved.autoOrient,
    original: true,
    timeToStale: opts.timeToStale ?? resolved.timeToStale,
    timeToEvict: opts.timeToEvict ?? resolved.timeToEvict,
  };
}

/**
 * Build a signed URL that serves the cached, full-size original (no resize,
 * original bytes + content-type). Sibling of `getResizedImage` — usable
 * directly in `<img src>`. Server-side only.
 */
export function getImage(src: string, opts: OriginalImageOptions = {}): string {
  const { options } = getImageRuntime();
  const req = buildOriginalRequest(src, opts, options);
  return mintImageUrl(req, buildOriginalFilename(req), options);
}

/**
 * Fetch-or-serve the cached full-size original for `src`, applying the
 * shortest-wins TTL. Backs both the resize pipeline (so every variant reuses
 * one origin download) and `getImage`/`getImageBytes`.
 */
export async function getCachedOriginal(
  src: string,
  opts: OriginalImageOptions,
  resolved: ResolvedImageOptions,
  cache: ImageCache,
): Promise<{ bytes: Uint8Array; contentType: string; status: ImageCacheStatus; createdAt: number }> {
  const ts = opts.timeToStale ?? resolved.timeToStale;
  const te = opts.timeToEvict ?? resolved.timeToEvict;
  const { entry, status } = await cache.getOriginal(src, ts, te, () => fetchImageSource(src, resolved));
  return { bytes: entry.bytes, contentType: entry.meta.contentType, status, createdAt: entry.meta.createdAt };
}

/**
 * Return the cached full-size original bytes (+ content-type) for server-side
 * use. Returns `null` if the source can't be fetched, mirroring
 * `getImagePlaceholder`'s degrade-gracefully contract.
 */
export async function getImageBytes(src: string, opts: OriginalImageOptions = {}): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const { options, cache } = getImageRuntime();
  try {
    const { bytes, contentType } = await getCachedOriginal(src, opts, options, cache);
    return { bytes, contentType };
  } catch (err) {
    logger.warn(`Could not load image bytes for ${src}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function recordForDebugBar(url: string, filename: string, req: ImageRequest, resolved: ResolvedImageOptions): void {
  try {
    const ctx = requestContext.getStore();
    const images = ctx?.debugBarData?.images;
    if (images && !images.some((i) => i.url === url)) {
      const packed = packImageRequest(req, resolved);
      const srcBytes = Buffer.byteLength(req.src, 'utf-8');
      const headerHex = Array.from(packed.subarray(0, packed.length - srcBytes), (b) => b.toString(16).padStart(2, '0')).join(' ');
      images.push({ url, filename, params: { ...req }, wire: { headerHex, srcBytes } });
    }
  } catch {
    // Debug recording is best-effort; ignore failures.
  }
}

/**
 * Return a tiny ThumbHash blur-placeholder data URL for a source, computing and
 * caching it on first use. Returns `null` if the source can't be fetched or
 * decoded, so callers can degrade gracefully.
 */
export async function getImagePlaceholder(src: string): Promise<string | null> {
  const { options, cache } = getImageRuntime();
  const cached = await cache.getPlaceholder(src);
  if (cached) {
    return cached;
  }
  try {
    const { bytes } = await getCachedOriginal(src, {}, options, cache);
    const dataUrl = await computePlaceholder(bytes, options);
    await cache.setPlaceholder(src, dataUrl);
    return dataUrl;
  } catch (err) {
    logger.warn(`Could not compute image placeholder for ${src}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Immediately invalidate a source. Operates on the shared original, so it
 * cascades to every resized variant. `hard: false` (default) marks it stale —
 * the next request serves the cached bytes and re-fetches in the background;
 * `hard: true` marks it expired — the next request blocks for a fresh re-fetch.
 */
export async function invalidateImage(src: string, opts: InvalidateImageOptions = {}): Promise<void> {
  const { cache } = getImageRuntime();
  await cache.invalidateOriginal(src, opts.hard ?? false);
}
