import { getImageRuntime } from './config';
import { fetchImageSource } from './fetchSource';
import { verifyImageToken } from './imageCrypto';
import { variantId } from './imageCache';
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
 * The `/_mochi/image/<filename>?payload=…&sig=…` endpoint: verify the signature,
 * then serve from the stale-while-revalidate disk cache, regenerating on miss
 * by fetching + resizing the source. The path filename is cosmetic.
 */
export function createImageHandler(): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const { options, cache } = getImageRuntime();

    const url = new URL(req.url);
    const filename = url.pathname.split('/').pop() ?? '';
    const token = url.searchParams.get('payload') ?? '';
    const sig = url.searchParams.get('sig') ?? '';

    if (!token || !sig) {
      return textResponse(403, 'Missing signature');
    }

    // The signature binds both the payload and the cosmetic filename, so a
    // tampered path (e.g. swapped /my-image.webp) fails verification.
    const request = verifyImageToken(token, sig, filename);
    if (!request) {
      return textResponse(403, 'Invalid signature');
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
        const { bytes } = await fetchImageSource(request.src, options);
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
