import type { BunFile } from 'bun';
import { COMPRESSION_TOKEN } from './index';

export interface DiskAssetInfo {
  diskPath: string;
  /** Omit to take the type Bun infers from the file's extension. */
  contentType?: string;
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** A miss or a file gone from disk yields null so callers 404 rather than surfacing Bun.file's lazy ENOENT as a 500. */
async function openAsset(info: DiskAssetInfo | undefined): Promise<{ file: BunFile; headers: Record<string, string> } | null> {
  if (!info) {
    return null;
  }
  const file = Bun.file(info.diskPath);
  if (!(await file.exists())) {
    return null;
  }
  return {
    file,
    headers: {
      'Content-Type': info.contentType || file.type || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    },
  };
}

// Derived from the tokens `compress()` appends rather than hard-coded, so the two can't drift into a state where a
// client revalidating a compressed representation stops matching the identity validator.
const ENCODING_SUFFIX = new RegExp(`-(?:${Object.values(COMPRESSION_TOKEN).join('|')})$`, 'i');

function normalizeEtag(tag: string): string {
  let t = tag.trim();
  if (t.startsWith('W/')) {
    t = t.slice(2);
  }
  t = t.replace(/^"|"$/g, '');
  return t.replace(ENCODING_SUFFIX, '');
}

/**
 * The client's matching entity-tag rather than ours, so a `304` can carry the validator of the representation the client
 * actually holds (RFC 9110 §15.4.5) — echoing the identity tag for a revalidated `-br` body lets a shared cache file both
 * encodings under one validator.
 */
function matchedEtag(header: string, etag: string): string | null {
  const target = normalizeEtag(etag);
  for (const raw of header.split(',')) {
    const candidate = raw.trim();
    if (candidate === '*') {
      return etag;
    }
    if (normalizeEtag(candidate) === target) {
      return candidate;
    }
  }
  return null;
}

/** Anything unparseable or unsatisfiable returns null and is served as a full `200`, which RFC 9110 §14.2 permits. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return null;
  }
  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;
  if (rawStart === '') {
    // A suffix range (`bytes=-500`) asks for the last N bytes.
    const suffix = Number(rawEnd);
    if (!rawEnd || suffix === 0) {
      return null;
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return null;
  }
  return { start, end };
}

/**
 * Shared response builder for every disk-backed asset route (extracted fonts, locally-imported images): content-hashed
 * names get an immutable `Cache-Control` in production only.
 */
export async function serveDiskAsset(info: DiskAssetInfo | undefined, development: boolean): Promise<Response> {
  const opened = await openAsset(info);
  if (!opened) {
    return notFound();
  }
  const { file, headers } = opened;
  // Declared up front so a HEAD can answer from the header instead of buffering the file to measure it.
  headers['Content-Length'] = String(file.size);
  if (!development) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }
  return new Response(file, { headers });
}

/**
 * Serve an on-disk file that lives at a stable, non-content-hashed URL (publicDir, `Mochi.file()`): it sets
 * `Last-Modified` + a weak `ETag` and answers `If-None-Match`/`If-Modified-Since` with a bodyless `304` itself, because
 * a downstream `compress()` materializes the body into a buffer and strips the conditional handling Bun would otherwise
 * apply to a `BunFile` at serialization time. `Range` is answered here for the same reason — any middleware that rebuilds
 * the response (`filterResponseHeaders` does) turns the `BunFile` into a plain stream and loses Bun's own `206`.
 */
export async function serveStaticFile(info: DiskAssetInfo | undefined, opts: { request: Request; cacheControl?: string }): Promise<Response> {
  const opened = await openAsset(info);
  if (!opened) {
    return notFound();
  }
  const { file, headers } = opened;

  const lastModifiedMs = file.lastModified;
  const etag = `W/"${file.size.toString(16)}-${lastModifiedMs.toString(16)}"`;
  headers['Accept-Ranges'] = 'bytes';
  headers['ETag'] = etag;
  headers['Last-Modified'] = new Date(lastModifiedMs).toUTCString();
  if (opts.cacheControl) {
    headers['Cache-Control'] = opts.cacheControl;
  }

  const ifNoneMatch = opts.request.headers.get('If-None-Match');
  const ifModifiedSince = opts.request.headers.get('If-Modified-Since');
  // If-None-Match takes precedence over If-Modified-Since per RFC 9110.
  const matched = ifNoneMatch ? matchedEtag(ifNoneMatch, etag) : null;
  const notModified = ifNoneMatch
    ? matched !== null
    : ifModifiedSince
      ? (() => {
          const since = Date.parse(ifModifiedSince);
          return !Number.isNaN(since) && Math.floor(lastModifiedMs / 1000) * 1000 <= since;
        })()
      : false;
  if (notModified) {
    return new Response(null, {
      status: 304,
      headers: { ETag: matched ?? etag, 'Last-Modified': headers['Last-Modified']!, ...(opts.cacheControl ? { 'Cache-Control': opts.cacheControl } : {}) },
    });
  }

  const rangeHeader = opts.request.headers.get('Range');
  const range = rangeHeader ? parseRange(rangeHeader, file.size) : null;
  if (range) {
    const { start, end } = range;
    // `.stream()`, not the slice itself: reading `.body` off a Blob-backed Response yields everything from the offset to
    // EOF, so a middleware that rebuilds the response would silently widen the window back out.
    return new Response(file.slice(start, end + 1).stream(), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Content-Length': String(end - start + 1) },
    });
  }

  headers['Content-Length'] = String(file.size);
  return new Response(file, { headers });
}
