import { getImageAssetPrefix, getImageRuntime, getSize } from './config';
import { fetchImageSource } from './fetchSource';
import { encryptImageRequest } from './imageCrypto';
import { variantId } from './imageCache';
import { computePlaceholder, extForFormat, runPipeline } from './resize';
import { buildImageFilename, buildOriginalFilename } from './slug';
import { requestContext, type ImageDebugEntry } from '../requestContext';
import { applyFilter } from '../extensions';
import { logger } from '../log';
import type { ImageCache, ImageCacheStatus } from './imageCache';
import type { ImageRequest, InvalidateImageOptions, OriginalImageOptions, ResolvedImageOptions, ResolvedImageSize } from './types';

const warnedUnknownSize = new Set<string>();

// Resolve a size name against the config, warning once per unknown name.
// An unknown/absent name degrades to the full-size original.
function resolveNamed(name: string | undefined, options: ResolvedImageOptions): ResolvedImageSize | undefined {
  if (name === undefined) {
    return undefined;
  }
  const size = getSize(name, options);
  if (!size && !warnedUnknownSize.has(name)) {
    warnedUnknownSize.add(name);
    logger.warn(`Image size "${name}" is not defined in image.sizes; serving the full-size original.`);
  }
  return size;
}

// Resolve the size and mint the signed URL in one pass (so callers that also
// want the size's dimensions don't resolve/warn twice).
function mintFor(src: string, size: string | undefined, options: ResolvedImageOptions): { url: string; resolved: ResolvedImageSize | undefined } {
  const resolved = resolveNamed(size, options);
  const req: ImageRequest = resolved ? { src, size: resolved.name } : { src, original: true };
  const filename = resolved ? buildImageFilename(src, resolved) : buildOriginalFilename(src);
  return { url: mintImageUrl(req, filename, resolved, options), resolved };
}

/**
 * Build a signed, cacheable URL for `src` transformed through a named size.
 * Server-side only (it reads the signing secret). Synchronous and near-instant —
 * no fetch, decode, or encode happens here; the endpoint applies the size lazily
 * on the browser's request. An unknown/omitted size name serves the full-size
 * original (with a one-time server-log warning). Path:
 * `/_mochi/image/my-image-thumbnail.webp?p=<token>`.
 */
export function getImageUrl(src: string, size?: string): string {
  return mintFor(src, size, getImageRuntime().options).url;
}

export interface ImageAttrs {
  url: string;
  /** The size's declared width (px), for the `<img width>` attribute. */
  width?: number;
  /** The size's declared height (px), for the `<img height>` attribute. */
  height?: number;
}

/**
 * The signed URL plus the size's declared dimensions — used by `<Image>` to
 * set the `<img>` `src`/`width`/`height` in one server-side pass. Server-only.
 */
export function getImageAttrs(src: string, size?: string): ImageAttrs {
  const { url, resolved } = mintFor(src, size, getImageRuntime().options);
  return { url, width: resolved?.width, height: resolved?.height };
}

let warnedDisabled = false;

// Mint the signed URL and let the `image:url` filter rewrite it (e.g. prepend a
// CDN origin) before it's recorded/returned — so the debug bar logs what the
// caller actually gets.
function mintImageUrl(req: ImageRequest, filename: string, size: ResolvedImageSize | undefined, options: ResolvedImageOptions): string {
  // The endpoint isn't registered when the feature is off, so a minted URL
  // would silently 404. Degrade to the raw source URL instead.
  if (!options.enabled) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      logger.warn('The image endpoint is disabled (image.enabled is false); getImageUrl returns the raw source URL.');
    }
    return req.src;
  }
  const token = encryptImageRequest(req, filename, options.compressPayload);
  const raw = `${getImageAssetPrefix()}/image/${filename}?p=${token}`;
  const url = applyFilter('image:url', raw, { src: req.src, filename, original: req.original === true });
  recordForDebugBar(url, filename, req, size);
  return url;
}

export interface ResolvedImage {
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  format: string;
}

/**
 * Run a named size inline and return the transformed bytes + metadata for
 * server-side use (OG images, inlining, dimension probes). Shares the same disk
 * cache as `getImageUrl`/`<Image>`, so a warm variant skips the fetch/decode/encode.
 * Prefer `getImageUrl` for anything that ends up in an `<img src>` — it defers all
 * work to the endpoint. An unknown/omitted size returns the original bytes.
 * Server-side only.
 */
export async function getImage(src: string, size?: string): Promise<ResolvedImage> {
  const { options, cache } = getImageRuntime();
  const resolved = resolveNamed(size, options);

  if (!resolved) {
    const { bytes, contentType } = await getCachedOriginal(src, {}, options, cache);
    let meta = { width: 0, height: 0, format: '' };
    try {
      meta = await new Bun.Image(bytes).metadata();
    } catch {
      // Non-raster or undecodable original: return bytes with unknown dimensions.
    }
    const result = { bytes, contentType, width: meta.width, height: meta.height, format: meta.format };
    recordInlineForDebugBar(src, resolved, result);
    return result;
  }

  const id = variantId(src, resolved.configHash);
  const { entry } = await cache.getVariant(src, id, extForFormat(resolved.format), async () => {
    const { bytes, createdAt } = await getCachedOriginal(src, { timeToStale: resolved.timeToStale, timeToEvict: resolved.timeToEvict }, options, cache);
    const out = await runPipeline(bytes, resolved, options);
    return { bytes: out.bytes, contentType: out.contentType, width: out.width, height: out.height, format: out.format, originalCreatedAt: createdAt };
  });
  const result = { bytes: entry.bytes, contentType: entry.meta.contentType, width: entry.meta.width, height: entry.meta.height, format: entry.meta.format };
  recordInlineForDebugBar(src, resolved, result);
  return result;
}

/**
 * Fetch-or-serve the cached full-size original for `src`, applying the
 * shortest-wins TTL. Backs both the size path (so every variant reuses one
 * origin download) and the original path of `getImageUrl`/`getImage`.
 */
export async function getCachedOriginal(
  src: string,
  opts: OriginalImageOptions,
  resolved: ResolvedImageOptions,
  cache: ImageCache,
): Promise<{ bytes: Uint8Array; contentType: string; status: ImageCacheStatus; createdAt: number }> {
  const timeToStale = opts.timeToStale ?? resolved.timeToStale;
  const timeToEvict = opts.timeToEvict ?? resolved.timeToEvict;
  const { entry, status } = await cache.getOriginal(src, timeToStale, timeToEvict, () => fetchImageSource(src, resolved));
  return { bytes: entry.bytes, contentType: entry.meta.contentType, status, createdAt: entry.meta.createdAt };
}

/**
 * Push an entry into the current request's debug-bar image list, de-duped by
 * `id`/`url`. Best-effort — ignores any failure and is a no-op when the debug bar
 * isn't active (no `debugBarData`).
 */
export function pushDebugImage(entry: ImageDebugEntry): void {
  try {
    const images = requestContext.getStore()?.debugBarData?.images;
    const key = entry.id ?? entry.url;
    if (images && !images.some((i) => (i.id ?? i.url) === key)) {
      images.push(entry);
    }
  } catch {
    // Debug recording is best-effort; ignore failures.
  }
}

function recordForDebugBar(url: string, filename: string, req: ImageRequest, size: ResolvedImageSize | undefined): void {
  if (!requestContext.getStore()?.debugBarData?.images) {
    return;
  }
  pushDebugImage({
    url,
    filename,
    kind: 'url',
    size: req.size,
    params: { src: req.src, ...(size ? { width: size.width, height: size.height, format: size.format, quality: size.quality } : { original: true }) },
  });
}

function recordInlineForDebugBar(src: string, size: ResolvedImageSize | undefined, result: ResolvedImage): void {
  try {
    if (!requestContext.getStore()?.debugBarData?.images) {
      return;
    }
    const url = result.bytes.byteLength <= INLINE_PREVIEW_BYTE_CAP ? `data:${result.contentType};base64,${Buffer.from(result.bytes).toString('base64')}` : '';
    pushDebugImage({
      url,
      id: size ? variantId(src, size.configHash) : `inline-original:${src}`,
      filename: size ? buildImageFilename(src, size) : buildOriginalFilename(src),
      kind: 'inline',
      size: size?.name,
      params: { src, width: result.width, height: result.height, format: result.format },
    });
  } catch {
    // Debug recording is best-effort; ignore failures.
  }
}

// Cap for the inline preview `data:` URL — an inline result has no served URL, so
// the preview is the base64 bytes. Beyond this we record without a preview.
const INLINE_PREVIEW_BYTE_CAP = 1_048_576;

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
    const { bytes, createdAt } = await getCachedOriginal(src, {}, options, cache);
    const dataUrl = await computePlaceholder(bytes, options);
    await cache.setPlaceholder(src, dataUrl, createdAt);
    return dataUrl;
  } catch (err) {
    logger.warn(`Could not compute image placeholder for ${src}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const warmingPlaceholders = new Set<string>();

/**
 * Kick off (but do not await) placeholder computation for `src`, so it's cached
 * for a later render. Non-blocking: `<Image placeholder>` calls this on a cache
 * miss and ships the first cold render without a blur; the next render for the
 * same source finds the cached blur. De-duped per source while in flight.
 */
export function warmImagePlaceholder(src: string): void {
  if (warmingPlaceholders.has(src)) {
    return;
  }
  warmingPlaceholders.add(src);
  void getImagePlaceholder(src)
    .catch(() => {})
    .finally(() => warmingPlaceholders.delete(src));
}

/**
 * Non-blocking placeholder read for `<Image placeholder>`: returns the cached
 * ThumbHash blur if present, otherwise `null` and kicks off a background warm so
 * a later render has it. Never blocks SSR on a fetch/decode. Server-only.
 */
export async function imagePlaceholder(src: string): Promise<string | null> {
  const { cache } = getImageRuntime();
  const cached = await cache.getPlaceholder(src);
  if (cached) {
    return cached;
  }
  warmImagePlaceholder(src);
  return null;
}

/**
 * Immediately invalidate a source. Operates on the shared original, so it
 * cascades to every variant. `hard: false` (default) marks it stale — the next
 * request serves the cached bytes and re-fetches in the background; `hard: true`
 * marks it expired — the next request blocks for a fresh re-fetch.
 */
export async function invalidateImage(src: string, opts: InvalidateImageOptions = {}): Promise<void> {
  const { cache } = getImageRuntime();
  await cache.invalidateOriginal(src, opts.hard ?? false);
}
