import { promisify } from 'node:util';
import { brotliCompress as brotliCompressCb, constants as zlibConstants, gzip as gzipCb } from 'node:zlib';
import type { Handle } from '../runtime/hooks';
import { getMochiConfig } from '../mochiConfig';
import { appendVary, COMPRESSION_TOKEN, negotiateEncoding } from '../utils';
import type { CompressionMethod } from '../utils';
const gzipAsync = promisify(gzipCb);
const brotliAsync = promisify(brotliCompressCb);

// woff/woff2 are omitted deliberately: they are already zlib/Brotli containers, so re-compressing wastes CPU for ~0%.
// ttf/otf/eot are uncompressed SFNT/embedded formats and shrink ~50%.
const COMPRESSIBLE_TYPES = [
  'text/',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/manifest+json',
  'application/ld+json',
  'image/svg+xml',
  'font/ttf',
  'font/otf',
  'application/vnd.ms-fontobject',
];

export interface CompressOptions {
  methods?: CompressionMethod[];
  brotliQuality?: number;
}

function isCompressible(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return COMPRESSIBLE_TYPES.some((prefix) => lower.startsWith(prefix));
}

// Append the encoding token inside the quotes so `W/"abc"` becomes `W/"abc-br"`, keeping the weak/strong prefix intact.
function suffixEtag(etag: string, token: string): string {
  const close = etag.lastIndexOf('"');
  if (close <= 0) {
    return etag;
  }
  return `${etag.slice(0, close)}-${token}${etag.slice(close)}`;
}

function isDev(): boolean {
  try {
    return getMochiConfig().options.development ?? true;
  } catch {
    // Mochi.serve() hasn't initialized config (e.g. unit tests) — assume prod.
    return false;
  }
}

/**
 * Negotiates response compression between gzip and brotli using `Accept-Encoding`.
 * The client's preference (header order + q-values) wins among encodings allowed
 * by `methods`; the array order is only the tiebreak for `Accept-Encoding: *`.
 */
export function compress(opts: CompressOptions = {}): Handle {
  const methods = opts.methods ?? ['brotli', 'gzip'];
  const brotliQuality = opts.brotliQuality ?? 4;

  return async ({ event, resolve }) => {
    const response = await resolve(event);

    if (isDev()) {
      return response;
    }

    if (response.headers.get('Content-Encoding')) {
      return response;
    }

    appendVary(response.headers, 'Accept-Encoding');

    if (methods.length === 0) {
      return response;
    }

    // A range request (or a 206 partial the handler already produced) must stay uncompressed, or the byte offsets the
    // client asked for no longer address the body it receives.
    if (response.status === 206 || event.request.headers.get('Range') || response.headers.get('Content-Range')) {
      return response;
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    if (!isCompressible(contentType)) {
      return response;
    }

    const chosen = negotiateEncoding(event.request.headers.get('Accept-Encoding') ?? '', methods);
    if (!chosen) {
      return response;
    }

    const buf = new Uint8Array(await response.arrayBuffer());
    const compressed = chosen === 'brotli' ? await brotliAsync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality } }) : await gzipAsync(buf);

    const headers = new Headers(response.headers);
    headers.set('Content-Encoding', COMPRESSION_TOKEN[chosen]);
    headers.delete('Content-Length');
    // The compressed bytes are a distinct representation, so its validator must differ from the identity ETag or a cache
    // keyed without honoring `Vary` could serve the wrong one.
    const etag = headers.get('ETag');
    if (etag) {
      headers.set('ETag', suffixEtag(etag, COMPRESSION_TOKEN[chosen]));
    }

    return new Response(compressed, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
