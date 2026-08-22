import { promisify } from 'node:util';
import { brotliCompress as brotliCompressCb, constants as zlibConstants } from 'node:zlib';
import type { Handle } from '../runtime/hooks';
import { getMochiConfig } from '../mochiConfig';
import { appendVary, COMPRESSION_FORMAT, COMPRESSION_TOKEN, negotiateEncoding } from '../utils';
import type { CompressionMethod } from '../utils';
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
 * Negotiates response compression from `Accept-Encoding`. The client's preference (header order + q-values) wins among
 * encodings allowed by `methods`; the array order is only the tiebreak for `Accept-Encoding: *`.
 *
 * Every encoding but brotli streams through `CompressionStream`, so a chunked SSR response stays chunked. Brotli is
 * buffered because Bun's `CompressionStream('brotli')` is fixed at quality 11 — measured ~200x slower than the
 * `brotliQuality` default of 4 on a 400 KB page, which is far too slow for per-request SSR. Reach for `zstd` when you
 * want brotli-class ratios without giving up streaming.
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
    if (!chosen || !response.body) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set('Content-Encoding', COMPRESSION_TOKEN[chosen]);
    headers.delete('Content-Length');
    const init = { status: response.status, statusText: response.statusText, headers };

    if (chosen === 'brotli') {
      const compressed = await brotliAsync(new Uint8Array(await response.arrayBuffer()), { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality } });
      return new Response(compressed, init);
    }

    return new Response(response.body.pipeThrough(new CompressionStream(COMPRESSION_FORMAT[chosen] as CompressionFormat)), init);
  };
}
