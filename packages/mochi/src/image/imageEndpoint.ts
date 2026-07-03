import { getImageRuntime } from './config';
import { getCachedOriginal } from './getResizedImage';
import { decryptImageRequest } from './imageCrypto';
import { originalId, variantId } from './imageCache';
import { getMochiConfig } from '../mochiConfig';
import { resizeImage } from './resize';
import { ImageError } from './types';
import type { ImageRequest, ResolvedImageOptions } from './types';

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const INLINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);

/**
 * Originals are served verbatim from an upstream we don't fully control. Only
 * raster image types are safe to render inline in our origin; anything else
 * (`image/svg+xml`, `text/html`, …) is forced to a non-rendering download to
 * prevent same-origin XSS — `nosniff` alone wouldn't stop a directly-navigated
 * SVG from executing, so the Content-Type is rewritten rather than just labelled.
 */
export function safeOriginalContentType(contentType: string): { contentType: string; attachment: boolean } {
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  if (INLINE_IMAGE_TYPES.has(base)) {
    return { contentType, attachment: false };
  }
  return { contentType: 'application/octet-stream', attachment: true };
}

/**
 * Browser/CDN cache policy for a successful image response, derived from the
 * entry's SWR window: cache without revalidating for `timeToStale`, then serve
 * stale while revalidating in the background for the rest of the evict window.
 * The URL is stable per (src, params), so correctness across a refresh rides on
 * the generation-aware ETag once `max-age` lapses. Trade-off: `invalidateImage()`
 * reaches an already-cached browser only after its `max-age` expires.
 */
export function imageCacheControl(timeToStaleMs: number, timeToEvictMs: number): string {
  const maxAge = Math.max(0, Math.floor(timeToStaleMs / 1000));
  const swr = Math.max(0, Math.floor((timeToEvictMs - timeToStaleMs) / 1000));
  return swr > 0 ? `public, max-age=${maxAge}, stale-while-revalidate=${swr}` : `public, max-age=${maxAge}`;
}

// The Cache-Control for both originals and variants: undefined in dev (so
// edits/invalidations aren't fought by the browser cache), else derived from the
// per-request TTL override the response actually used, falling back to defaults.
export function resolveImageCacheControl(request: ImageRequest, options: ResolvedImageOptions, development: boolean): string | undefined {
  if (development) {
    return undefined;
  }
  return imageCacheControl(request.timeToStale ?? options.timeToStale, request.timeToEvict ?? options.timeToEvict);
}

/**
 * The `/_mochi/image/<filename>?p=…` endpoint: decrypt the payload (the
 * filename is bound as AAD), then serve from the stale-while-revalidate disk
 * cache, regenerating on miss by fetching + resizing the source.
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

    // The filename is bound as AAD, so a tampered path (e.g. swapped
    // /my-image.webp) or payload fails decryption.
    const request = decryptImageRequest(token, filename, options);
    if (!request) {
      return textResponse(403, 'Invalid payload');
    }

    // Full-size original: serve the shared cached bytes verbatim. The resize
    // format/fit guards below don't apply (originals may be gif/svg/etc.).
    if (request.original) {
      try {
        const { bytes, contentType, status, createdAt } = await getCachedOriginal(
          request.src,
          { timeToStale: request.timeToStale, timeToEvict: request.timeToEvict },
          options,
          cache,
        );
        // ETag carries the cache generation, so a re-fetched/invalidated source
        // yields a new ETag and a stale conditional request gets fresh bytes.
        const etag = `"${originalId(request.src)}-${createdAt}"`;
        const cacheControl = resolveImageCacheControl(request, options, development);
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

    if (!options.outputFormats.includes(request.format)) {
      return textResponse(415, 'Output format not allowed');
    }
    if (request.fit !== 'inside' && request.fit !== 'fill') {
      return textResponse(415, 'Invalid fit');
    }

    try {
      const { entry, status } = await cache.get(request, async () => {
        const { bytes, createdAt } = await getCachedOriginal(request.src, { timeToStale: request.timeToStale, timeToEvict: request.timeToEvict }, options, cache);
        const result = await resizeImage(bytes, request, options);
        return {
          bytes: result.bytes,
          contentType: result.contentType,
          width: result.width,
          height: result.height,
          format: result.format,
          originalCreatedAt: createdAt,
        };
      });

      // ETag carries the served bytes' generation (bumped on regeneration), so
      // revalidation reflects the current content rather than the stable id.
      const etag = `"${variantId(request)}-${entry.meta.createdAt}"`;
      // Honour the per-request TTL override (the same one that fetched/shortened
      // the shared original) — otherwise the browser could cache a variant far
      // longer than the original's real window.
      const cacheControl = resolveImageCacheControl(request, options, development);
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
