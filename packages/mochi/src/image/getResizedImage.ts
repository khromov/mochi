import { getImageAssetPrefix, getImageRuntime } from './config';
import { fetchImageSource } from './fetchSource';
import { signImageToken } from './imageCrypto';
import { computePlaceholder } from './resize';
import { buildImageFilename } from './slug';
import { requestContext } from '../requestContext';
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
 * the signing secret from the Mochi config). The path is a cosmetic,
 * human-readable filename derived from the source name + dimensions; the
 * authoritative signed request travels in the `payload` and `sig` query params:
 * `/_mochi/image/my-image-500x500.webp?payload=<token>&sig=<sig>`.
 */
export function getResizedImage(src: string, opts: ResizeImageOptions = {}): string {
  const { options } = getImageRuntime();
  const req = buildRequest(src, opts, options);
  const filename = buildImageFilename(req);
  const { token, sig } = signImageToken(req, filename);
  const url = `${getImageAssetPrefix()}/image/${filename}?payload=${token}&sig=${sig}`;
  recordForDebugBar(url, filename, req);
  return url;
}

/** Best-effort: record the decoded request for the dev debug bar (no-op in production). */
function recordForDebugBar(url: string, filename: string, req: ImageRequest): void {
  try {
    const ctx = requestContext.getStore();
    const images = ctx?.debugBarData?.images;
    if (images && !images.some((i) => i.url === url)) {
      images.push({ url, filename, params: { ...req } });
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
