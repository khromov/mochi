import path from 'node:path';
import { getImageRuntime, getSize } from './config';
import { getAssetPrefix } from '../mochiConfig';
import { fetchImageSource } from './fetchSource';
import { getLocalImageAsset } from './localAssetRegistry';
import { resolveLocalDirFile } from '../runtime/localDirs';
import { toPosixPath } from '../utils';
import { encryptImageRequest } from './imageCrypto';
import { variantId } from './imageCache';
import { computePlaceholder, runPipeline } from './resize';
import { buildImageFilename, buildOriginalFilename } from './slug';
import { requestContext, type ImageDebugEntry } from '../runtime/requestContext';
import { requestMemo } from '../runtime/requestCache';
import { applyFilter } from '../extensions';
import { logger } from '../utils/log';
import type { ImageCache, ImageCacheStatus } from './imageCache';
import type { ImageRequest, InvalidateImageOptions, ResolvedImageOptions, ResolvedImageSize } from './types';

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
 * Build a signed, cacheable URL for `src` transformed through a named size, e.g.
 * `/_mochi/image/my-image-thumbnail.webp?p=<token>`. Server-side only, since it reads the signing secret, and
 * synchronous: the endpoint applies the size lazily on the browser's request. Omitting the size serves the full-size
 * original, as does an unknown size name, with a one-time server-log warning.
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

/** The signed URL plus the size's declared dimensions, letting `<Image>` set `src`/`width`/`height` in one server-side pass. Server-only. */
export function getImageAttrs(src: string, size?: string): ImageAttrs {
  const { url, resolved } = mintFor(src, size, getImageRuntime().options);
  return { url, width: resolved?.width, height: resolved?.height };
}

let warnedDisabled = false;

// The `image:url` filter rewrites the minted URL (e.g. prepending a CDN origin) before it's recorded and returned, so
// the debug bar logs what the caller actually gets.
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
  const raw = `${getAssetPrefix()}/image/${filename}?p=${token}`;
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
 * Run a named size inline and return the transformed bytes plus metadata, for server-side use — OG images, inlining,
 * dimension probes. It shares the disk cache with `getImageUrl`/`<Image>`, so a warm variant skips fetch/decode/encode.
 * Prefer `getImageUrl` for anything landing in an `<img src>`, since that defers all work to the endpoint. An unknown or
 * omitted size returns the original bytes. Server-side only.
 */
export async function getImage(src: string, size?: string): Promise<ResolvedImage> {
  const { options, cache } = getImageRuntime();
  const resolved = resolveNamed(size, options);

  if (!resolved) {
    // `bytes` is the request-cached original, shared by every caller this
    // request — treat it as read-only; mutating it corrupts the shared entry.
    const { bytes, contentType } = await getCachedOriginal(src, options, cache);
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
  const { entry } = await cache.getVariant(src, id, async () => {
    // Shared request-cached original — read-only. `runPipeline` decodes without
    // mutating its input, so passing the shared buffer is safe.
    const { bytes, createdAt } = await getCachedOriginal(src, options, cache);
    const out = await runPipeline(bytes, resolved, options);
    return { bytes: out.bytes, contentType: out.contentType, width: out.width, height: out.height, format: out.format, originalCreatedAt: createdAt };
  });
  const result = { bytes: entry.bytes, contentType: entry.meta.contentType, width: entry.meta.width, height: entry.meta.height, format: entry.meta.format };
  recordInlineForDebugBar(src, resolved, result);
  return result;
}

/**
 * Fetch-or-serve the cached full-size original for `src`, backing both the size path — so every variant reuses one
 * origin download — and the original path of `getImageUrl`/`getImage`.
 *
 * It's request-cached because a warm original still costs a sidecar parse plus a full binary read off disk per call,
 * and `MochiCache` coalesces only on the miss path, so N variants over one source would re-read the same bytes N times.
 * Keying on `src` alone is safe since `resolved` and `cache` both come from the `getImageRuntime()` process singleton.
 * `quiet` covers the image endpoint, which runs outside a request context and legitimately falls through uncached.
 */
export const getCachedOriginal: (
  src: string,
  resolved: ResolvedImageOptions,
  cache: ImageCache,
) => Promise<{ bytes: Uint8Array; contentType: string; status: ImageCacheStatus; createdAt: number }> = requestMemo(readCachedOriginal, {
  namespace: 'mochi:image:original',
  key: (src) => src,
  quiet: true,
});

async function readCachedOriginal(
  src: string,
  resolved: ResolvedImageOptions,
  cache: ImageCache,
): Promise<{ bytes: Uint8Array; contentType: string; status: ImageCacheStatus; createdAt: number }> {
  const { entry, status } = await cache.getOriginal(src, () => fetchImageSource(src, resolved));
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

/**
 * For a locally-imported asset or a local-dir file, recover the original file's
 * display name + a project-relative path (`sourcePath` is recorded only by the
 * in-process dev build loader; local-dir srcs resolve to their disk path). Lets
 * the debug bar show `hero.jpg` and its source path instead of the content-hashed
 * served filename. Returns `undefined` when the src isn't local (or its source
 * path wasn't recorded, e.g. from a manifest).
 */
function localSourceDisplay(src: string): { filename: string; sourcePath: string } | undefined {
  const abs = getLocalImageAsset(src)?.sourcePath ?? localDirSrc(src)?.diskPath;
  if (!abs) {
    return undefined;
  }
  const rel = path.relative(process.cwd(), abs);
  const display = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : abs;
  return { filename: path.basename(abs), sourcePath: toPosixPath(display) };
}

// Same-origin-shape gate mirrors fetchSource: a remote src must never reach the
// resolver (it reads the asset prefix from the global config).
function localDirSrc(src: string): ReturnType<typeof resolveLocalDirFile> {
  return src.startsWith('/') ? resolveLocalDirFile(src) : undefined;
}

function isLocalSrc(src: string): boolean {
  return getLocalImageAsset(src) !== undefined || localDirSrc(src) !== undefined;
}

function recordForDebugBar(url: string, filename: string, req: ImageRequest, size: ResolvedImageSize | undefined): void {
  if (!requestContext.getStore()?.debugBarData?.images) {
    return;
  }
  const local = localSourceDisplay(req.src);
  pushDebugImage({
    url,
    filename: local?.filename ?? filename,
    kind: 'url',
    size: req.size,
    local: isLocalSrc(req.src),
    sourcePath: local?.sourcePath,
    params: { src: req.src, ...(size ? { width: size.width, height: size.height, format: size.format, quality: size.quality } : { original: true }) },
  });
}

function recordInlineForDebugBar(src: string, size: ResolvedImageSize | undefined, result: ResolvedImage): void {
  try {
    if (!requestContext.getStore()?.debugBarData?.images) {
      return;
    }
    const url = result.bytes.byteLength <= INLINE_PREVIEW_BYTE_CAP ? `data:${result.contentType};base64,${Buffer.from(result.bytes).toString('base64')}` : '';
    const local = localSourceDisplay(src);
    pushDebugImage({
      url,
      id: size ? variantId(src, size.configHash) : `inline-original:${src}`,
      filename: local?.filename ?? (size ? buildImageFilename(src, size) : buildOriginalFilename(src)),
      kind: 'inline',
      size: size?.name,
      local: isLocalSrc(src),
      sourcePath: local?.sourcePath,
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
 *
 * Request-cached, so repeated calls for one source in a single render share the
 * blocking compute rather than each paying the placeholder/original cache reads.
 */
export const getImagePlaceholder: (src: string) => Promise<string | null> = requestMemo(computeImagePlaceholder, {
  // Deliberately its own namespace, never shared with `imagePlaceholder` below:
  // that one returns `null` on a miss by design, and a shared entry would let
  // its `null` short-circuit a later blocking call in the same request.
  namespace: 'mochi:image:placeholder:blocking',
  // `quiet` because background warms + the image endpoint call this outside a request, where it legitimately falls through uncached.
  quiet: true,
});

async function computeImagePlaceholder(src: string): Promise<string | null> {
  const { options, cache } = getImageRuntime();
  const cached = await cache.getPlaceholder(src);
  if (cached) {
    return cached;
  }
  try {
    const { bytes, createdAt } = await getCachedOriginal(src, options, cache);
    const dataUrl = await computePlaceholder(bytes, options);
    await cache.setPlaceholder(src, dataUrl, createdAt);
    return dataUrl;
  } catch (err) {
    logger.warn(`Could not compute image placeholder for ${src}: ${err instanceof Error ? err.message : String(err)}`);
    // Resolving `null` rather than throwing means the request cache keeps this
    // entry instead of evicting it — deliberate, so one unreachable source costs
    // a single failed fetch per request rather than one per caller.
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
 *
 * Request-cached, so a gallery of N `<Image placeholder>` over the same source
 * resolves to one cache read instead of N. The entry dies with the request, so
 * an invalidation is still picked up by the next render.
 */
export const imagePlaceholder: (src: string) => Promise<string | null> = requestMemo(readPlaceholder, { namespace: 'mochi:image:placeholder', quiet: true });

async function readPlaceholder(src: string): Promise<string | null> {
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

// Runtime local-dir lookup — re-exported here so the `__MOCHI_IMAGE_API__`
// virtual-module token covers it for .svelte files alongside the other image APIs.
export { localImage } from './localImage';
