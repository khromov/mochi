import { getImageRuntime, getSize } from './config';
import { getCachedOriginal } from './imageApi';
import { decryptImageRequest } from './imageCrypto';
import { originalId, variantId } from './imageCache';
import { getMochiConfig } from '../mochiConfig';
import { logger } from '../utils/log';
import { baseContentType, INLINE_SAFE_IMAGE_TYPES } from '../utils/inlineContentTypeSafety';
import { runPipeline } from './resize';
import { ImageError } from './types';
import type { ResolvedImageSize } from './types';

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Originals come verbatim from an upstream we don't fully control, and only raster image types are safe to render
 * inline in our origin, so anything else (`image/svg+xml`, `text/html`) becomes a non-rendering download. The
 * Content-Type is rewritten rather than merely labelled, since `nosniff` alone wouldn't stop a directly-navigated SVG
 * from executing.
 */
export function safeOriginalContentType(contentType: string): { contentType: string; attachment: boolean } {
  if (INLINE_SAFE_IMAGE_TYPES.has(baseContentType(contentType))) {
    return { contentType, attachment: false };
  }
  return { contentType: 'application/octet-stream', attachment: true };
}

/**
 * Browser/CDN cache policy for a successful image response, derived from the entry's SWR window: cache without
 * revalidating for `timeToStale`, then serve stale while revalidating for the rest of the evict window. The URL is
 * stable per (src, size), so correctness across a refresh rides on the generation-aware ETag once `max-age` lapses.
 */
export function imageCacheControl(timeToStaleMs: number, timeToEvictMs: number): string {
  const maxAge = Math.max(0, Math.floor(timeToStaleMs / 1000));
  const swr = Math.max(0, Math.floor((timeToEvictMs - timeToStaleMs) / 1000));
  return swr > 0 ? `public, max-age=${maxAge}, stale-while-revalidate=${swr}` : `public, max-age=${maxAge}`;
}

// Undefined in dev, so the browser cache doesn't fight edits and invalidations; otherwise derived from the effective
// TTL window — a size's overrides or the global defaults.
export function resolveImageCacheControl(timeToStale: number, timeToEvict: number, development: boolean): string | undefined {
  if (development) {
    return undefined;
  }
  return imageCacheControl(timeToStale, timeToEvict);
}

const warnedUnknownSize = new Set<string>();

function warnUnknownSize(name: string): void {
  if (!warnedUnknownSize.has(name)) {
    warnedUnknownSize.add(name);
    logger.warn(`Image request referenced unknown size "${name}" (redefined/removed since minting); serving the full-size original.`);
  }
}

/**
 * The `/_mochi/image/<filename>?p=…` endpoint: decrypt the payload with the filename bound as AAD, then serve from the
 * stale-while-revalidate disk cache, regenerating on a miss by fetching the source and running the referenced named
 * size. An `original` request, or an unknown size name, serves the shared original bytes verbatim.
 */
export function createImageHandler(): (req: Request) => Promise<Response> {
  // In dev, omit Cache-Control entirely so edits/invalidations show up on the
  // next request without fighting a browser cache.
  const development = getMochiConfig().options.development ?? true;
  return async (req: Request): Promise<Response> => {
    const { options, cache } = getImageRuntime();

    const url = new URL(req.url);
    const filename = url.pathname.split('/').pop() ?? '';
    const token = url.searchParams.get('p') ?? '';

    if (!token) {
      return textResponse(403, 'Missing payload');
    }

    // The filename is bound as AAD, so a tampered path or payload fails decryption.
    const request = decryptImageRequest(token, filename);
    if (!request) {
      return textResponse(403, 'Invalid payload');
    }

    const size: ResolvedImageSize | undefined = request.original ? undefined : getSize(request.size, options);
    if (request.size && !size) {
      warnUnknownSize(request.size);
    }

    // Full-size original: serve the shared cached bytes verbatim (originals may be
    // gif/svg/etc.). Covers explicit originals and unknown-size fallbacks.
    if (!size) {
      try {
        const { bytes, contentType, status, createdAt } = await getCachedOriginal(request.src, options, cache);
        const etag = `"${originalId(request.src)}-${createdAt}"`;
        const cacheControl = resolveImageCacheControl(options.timeToStale, options.timeToEvict, development);
        if (req.headers.get('if-none-match') === etag) {
          return new Response(null, { status: 304, headers: { ETag: etag, 'X-Content-Type-Options': 'nosniff', ...(cacheControl ? { 'Cache-Control': cacheControl } : {}) } });
        }
        const safe = safeOriginalContentType(contentType);
        return new Response(bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': safe.contentType,
            'Content-Length': String(bytes.byteLength),
            'X-Content-Type-Options': 'nosniff',
            ...(safe.attachment ? { 'Content-Disposition': 'attachment' } : {}),
            ETag: etag,
            ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
            'X-Mochi-Cache': status,
          },
        });
      } catch (err) {
        if (err instanceof ImageError) {
          return textResponse(err.status, err.message);
        }
        return textResponse(500, 'Image processing failed');
      }
    }

    try {
      const id = variantId(request.src, size.configHash);
      const { entry, status } = await cache.getVariant(request.src, id, async () => {
        const { bytes, createdAt } = await getCachedOriginal(request.src, options, cache);
        const result = await runPipeline(bytes, size, options);
        return {
          bytes: result.bytes,
          contentType: result.contentType,
          width: result.width,
          height: result.height,
          format: result.format,
          originalCreatedAt: createdAt,
        };
      });

      // The ETag carries the variant id, which folds in the size config hash, plus the original generation the bytes
      // came from, so a redefinition and a source refresh both revalidate while a re-encode from the same generation
      // keeps its ETag and avoids a spurious re-download.
      const etag = `"${id}-${entry.meta.originalCreatedAt ?? entry.meta.createdAt}"`;
      const cacheControl = resolveImageCacheControl(options.timeToStale, options.timeToEvict, development);
      if (req.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag, 'X-Content-Type-Options': 'nosniff', ...(cacheControl ? { 'Cache-Control': cacheControl } : {}) } });
      }

      // Uint8Array is a valid BodyInit at runtime; the cast bridges the
      // ArrayBufferLike/ArrayBuffer generic mismatch in the DOM lib types.
      return new Response(entry.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': entry.meta.contentType,
          'Content-Length': String(entry.bytes.byteLength),
          'X-Content-Type-Options': 'nosniff',
          ETag: etag,
          ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
          'X-Mochi-Cache': status,
        },
      });
    } catch (err) {
      if (err instanceof ImageError) {
        return textResponse(err.status, err.message);
      }
      return textResponse(500, 'Image processing failed');
    }
  };
}
