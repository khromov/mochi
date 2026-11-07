import type { Handle } from '../runtime/hooks';
import { isDev } from '../utils/env';
import { appendVary, COMPRESSION_FORMAT, COMPRESSION_TOKEN, negotiateEncoding } from '../utils';
import type { CompressionMethod } from '../utils';
import { logger } from '../utils/log';

const COMPRESSIBLE_TYPES = ['text/', 'application/json', 'application/javascript', 'application/xml', 'application/manifest+json', 'application/ld+json', 'image/svg+xml'];

export interface CompressOptions {
  methods?: CompressionMethod[];
}

function isCompressible(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return COMPRESSIBLE_TYPES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Negotiates response compression from `Accept-Encoding`. The client's preference (header order + q-values) wins among
 * encodings allowed by `methods`; the array order is only the tiebreak for `Accept-Encoding: *`.
 *
 * Every encoding streams through a single `CompressionStream`, so a chunked SSR response stays chunked. Brotli is
 * deliberately absent — Bun's `CompressionStream('brotli')` is fixed at quality 11, too slow for per-request SSR, so we
 * use `zstd` for brotli-class ratios instead and will revisit once Bun exposes a quality level (see the TODO in
 * `utils/index.ts`).
 */
export function compress(opts: CompressOptions = {}): Handle {
  const declared = opts.methods ?? ['zstd', 'gzip'];
  const methods = declared.filter((m) => COMPRESSION_TOKEN[m]);
  const dropped = declared.filter((m) => !COMPRESSION_TOKEN[m]);
  if (dropped.length > 0) {
    logger.warn(`compress(): ignoring unsupported method(s) ${dropped.join(', ')} — supported: ${Object.keys(COMPRESSION_TOKEN).join(', ')}.`);
  }

  return async ({ event, resolve }) => {
    const response = await resolve(event);

    if (isDev) {
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

    return new Response(response.body.pipeThrough(new CompressionStream(COMPRESSION_FORMAT[chosen] as CompressionFormat)), init);
  };
}
