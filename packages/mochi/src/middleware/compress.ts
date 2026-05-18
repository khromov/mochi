import { promisify } from 'node:util';
import { brotliCompress as brotliCompressCb, constants as zlibConstants, gzip as gzipCb } from 'node:zlib';
import type { Handle } from '../hooks';
import { getMochiConfig } from '../mochiConfig';
import { appendVary, COMPRESSION_TOKEN, negotiateEncoding } from '../utils';
import type { CompressionMethod } from '../utils';
const gzipAsync = promisify(gzipCb);
const brotliAsync = promisify(brotliCompressCb);

const COMPRESSIBLE_TYPES = ['text/', 'application/json', 'application/javascript', 'application/xml', 'application/manifest+json', 'application/ld+json', 'image/svg+xml'];

export interface CompressOptions {
  methods?: CompressionMethod[];
  brotliQuality?: number;
}

function isCompressible(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return COMPRESSIBLE_TYPES.some((prefix) => lower.startsWith(prefix));
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

    return new Response(compressed, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
