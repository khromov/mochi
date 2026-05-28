import { getImageAssetPrefix, getImageRuntime } from './config';
import { fetchImageSource } from './fetchSource';
import { signImageToken } from './imageCrypto';
import { computePlaceholder, extForFormat } from './resize';
import { logger } from '../log';
import type { ImageFormat, ImageRequest, ResizeImageOptions, ResolvedImageOptions } from './types';

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
    w: opts.width,
    h: opts.height,
    fit: opts.fit ?? 'inside',
    noUp: opts.withoutEnlargement ? true : undefined,
    fmt,
    q: clampQuality(opts.quality ?? resolved.defaultQuality),
    ao: opts.autoOrient ?? resolved.autoOrient,
    ts: opts.timeToStale ?? resolved.defaultTimeToStale,
    te: opts.timeToEvict ?? resolved.defaultTimeToEvict,
  };
}

/**
 * Build a signed, cacheable URL for a resized image. Server-side only (it reads
 * the signing secret from the Mochi config). Returns a path like
 * `/_mochi/image/<token>.webp?sig=<sig>`.
 */
export function getResizedImage(src: string, opts: ResizeImageOptions = {}): string {
  const { options } = getImageRuntime();
  const req = buildRequest(src, opts, options);
  const { token, sig } = signImageToken(req);
  return `${getImageAssetPrefix()}/image/${token}.${extForFormat(req.fmt)}?sig=${sig}`;
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
    const { bytes } = await fetchImageSource(src, options);
    const dataUrl = await computePlaceholder(bytes, options);
    await cache.setPlaceholder(src, dataUrl);
    return dataUrl;
  } catch (err) {
    logger.warn(`Could not compute image placeholder for ${src}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Invalidate cached images. With `opts`, removes the single matching variant;
 * without, removes every cached variant (and placeholder) of `src`.
 */
export async function invalidateImage(src: string, opts?: ResizeImageOptions): Promise<void> {
  const { options, cache } = getImageRuntime();
  if (opts) {
    await cache.invalidateVariant(buildRequest(src, opts, options));
  } else {
    await cache.invalidateSrc(src);
  }
}
