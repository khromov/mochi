import { getImageRuntime } from './config';
import { getCachedOriginal } from './getResizedImage';
import { decryptImageRequest } from './imageCrypto';
import { originalId, variantId } from './imageCache';
import { resizeImage } from './resize';
import { ImageError } from './types';
import type { ResolvedImageOptions } from './types';

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function cacheControl(options: ResolvedImageOptions): string {
  return `public, max-age=${options.browserMaxAge}, immutable`;
}

/**
 * The `/_mochi/image/<filename>?payload=…` endpoint: decrypt the payload (the
 * filename is bound as AAD), then serve from the stale-while-revalidate disk
 * cache, regenerating on miss by fetching + resizing the source.
 */
export function createImageHandler(): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const { options, cache } = getImageRuntime();

    const url = new URL(req.url);
    const filename = url.pathname.split('/').pop() ?? '';
    const token = url.searchParams.get('payload') ?? '';

    if (!token) {
      return textResponse(403, 'Missing payload');
    }

    // The filename is bound as GCM AAD, so a tampered path (e.g. swapped
    // /my-image.webp) or payload fails decryption.
    const request = decryptImageRequest(token, filename);
    if (!request) {
      return textResponse(403, 'Invalid payload');
    }

    // Full-size original: serve the shared cached bytes verbatim. The resize
    // format/fit guards below don't apply (originals may be gif/svg/etc.).
    if (request.orig) {
      const etag = `"${originalId(request.src)}"`;
      if (req.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': cacheControl(options) } });
      }
      try {
        const { bytes, contentType, status } = await getCachedOriginal(request.src, { timeToStale: request.ts, timeToEvict: request.te }, options, cache);
        return new Response(bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(bytes.byteLength),
            ETag: etag,
            'Cache-Control': cacheControl(options),
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

    if (!options.outputFormats.includes(request.fmt)) {
      return textResponse(415, 'Output format not allowed');
    }
    if (request.fit !== 'inside' && request.fit !== 'fill') {
      return textResponse(415, 'Invalid fit');
    }

    const etag = `"${variantId(request)}"`;
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': cacheControl(options) } });
    }

    try {
      const { entry, status } = await cache.get(request, async () => {
        const { bytes } = await getCachedOriginal(request.src, { timeToStale: request.ts, timeToEvict: request.te }, options, cache);
        const result = await resizeImage(bytes, request, options);
        return {
          bytes: result.bytes,
          contentType: result.contentType,
          width: result.width,
          height: result.height,
          format: result.format,
        };
      });

      // Uint8Array is a valid BodyInit at runtime; the cast bridges the
      // ArrayBufferLike/ArrayBuffer generic mismatch in the DOM lib types.
      return new Response(entry.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': entry.meta.contentType,
          'Content-Length': String(entry.bytes.byteLength),
          ETag: etag,
          'Cache-Control': cacheControl(options),
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
