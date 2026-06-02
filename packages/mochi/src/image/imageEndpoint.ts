import { getImageRuntime } from './config';
import { getCachedOriginal } from './getResizedImage';
import { decryptImageRequest } from './imageCrypto';
import { originalId, variantId } from './imageCache';
import { resizeImage } from './resize';
import { ImageError } from './types';

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * The `/_mochi/image/<filename>?p=…` endpoint: decrypt the payload (the
 * filename is bound as AAD), then serve from the stale-while-revalidate disk
 * cache, regenerating on miss by fetching + resizing the source.
 */
export function createImageHandler(): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const { options, cache } = getImageRuntime();

    const url = new URL(req.url);
    const filename = url.pathname.split('/').pop() ?? '';
    const token = url.searchParams.get('p') ?? '';

    if (!token) {
      return textResponse(403, 'Missing payload');
    }

    // The filename is bound as GCM AAD, so a tampered path (e.g. swapped
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
        if (req.headers.get('if-none-match') === etag) {
          return new Response(null, { status: 304, headers: { ETag: etag } });
        }
        return new Response(bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(bytes.byteLength),
            ETag: etag,
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
        const { bytes } = await getCachedOriginal(request.src, { timeToStale: request.timeToStale, timeToEvict: request.timeToEvict }, options, cache);
        const result = await resizeImage(bytes, request, options);
        return {
          bytes: result.bytes,
          contentType: result.contentType,
          width: result.width,
          height: result.height,
          format: result.format,
        };
      });

      // ETag carries the served bytes' generation (bumped on regeneration), so
      // revalidation reflects the current content rather than the stable id.
      const etag = `"${variantId(request)}-${entry.meta.createdAt}"`;
      if (req.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }

      // Uint8Array is a valid BodyInit at runtime; the cast bridges the
      // ArrayBufferLike/ArrayBuffer generic mismatch in the DOM lib types.
      return new Response(entry.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': entry.meta.contentType,
          'Content-Length': String(entry.bytes.byteLength),
          ETag: etag,
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
