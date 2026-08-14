/**
 * Shared response builder for every disk-backed asset route (extracted fonts, locally-imported images): a miss or a
 * file gone from disk 404s rather than surfacing Bun.file's lazy ENOENT as a 500, and content-hashed names get an
 * immutable `Cache-Control` in production only.
 */
export async function serveDiskAsset(info: { diskPath: string; contentType: string } | undefined, development: boolean): Promise<Response> {
  const notFound = (): Response => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (!info) {
    return notFound();
  }
  const file = Bun.file(info.diskPath);
  if (!(await file.exists())) {
    return notFound();
  }
  const headers: Record<string, string> = {
    'Content-Type': info.contentType,
    'X-Content-Type-Options': 'nosniff',
  };
  if (!development) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }
  return new Response(file, { headers });
}

function staticNotFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// Normalize an entity-tag for weak comparison: drop the `W/` prefix, the quotes, and any encoding suffix `compress()`
// appended (`-br`/`-gz`), so a client revalidating a compressed representation still matches the identity validator.
function normalizeEtag(tag: string): string {
  let t = tag.trim();
  if (t.startsWith('W/')) {
    t = t.slice(2);
  }
  t = t.replace(/^"|"$/g, '');
  // Strip the encoding tokens `compress()` appends (`COMPRESSION_TOKEN`: `br` / `gzip`).
  return t.replace(/-(?:br|gzip)$/i, '');
}

function ifNoneMatchSatisfied(header: string, etag: string): boolean {
  const target = normalizeEtag(etag);
  return header.split(',').some((raw) => {
    const t = raw.trim();
    return t === '*' || normalizeEtag(t) === target;
  });
}

/**
 * Serve an on-disk file that lives at a stable, non-content-hashed URL (publicDir, `Mochi.file()`): it sets
 * `Last-Modified` + a weak `ETag` and answers `If-None-Match`/`If-Modified-Since` with a bodyless `304` itself, because
 * a downstream `compress()` materializes the body into a buffer and strips the conditional/range handling Bun would
 * otherwise apply to a `BunFile` at serialization time. A `Range` request returns the raw `BunFile` so Bun produces the
 * `206`; `compress()` skips it on the `Range` header.
 */
export async function serveStaticFile(info: { diskPath: string; contentType: string } | undefined, opts: { request: Request; cacheControl?: string }): Promise<Response> {
  if (!info) {
    return staticNotFound();
  }
  const file = Bun.file(info.diskPath);
  if (!(await file.exists())) {
    return staticNotFound();
  }

  const lastModifiedMs = file.lastModified;
  const etag = `W/"${file.size.toString(16)}-${lastModifiedMs.toString(16)}"`;

  const headers: Record<string, string> = {
    'Content-Type': info.contentType,
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': new Date(lastModifiedMs).toUTCString(),
  };
  if (opts.cacheControl) {
    headers['Cache-Control'] = opts.cacheControl;
  }

  const ifNoneMatch = opts.request.headers.get('If-None-Match');
  const ifModifiedSince = opts.request.headers.get('If-Modified-Since');
  // If-None-Match takes precedence over If-Modified-Since per RFC 9110.
  const notModified = ifNoneMatch
    ? ifNoneMatchSatisfied(ifNoneMatch, etag)
    : ifModifiedSince
      ? (() => {
          const since = Date.parse(ifModifiedSince);
          return !Number.isNaN(since) && Math.floor(lastModifiedMs / 1000) * 1000 <= since;
        })()
      : false;
  if (notModified) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Last-Modified': headers['Last-Modified']!, ...(opts.cacheControl ? { 'Cache-Control': opts.cacheControl } : {}) },
    });
  }

  // A range request stays a BunFile body so Bun emits the 206; compress() skips it on the request's Range header.
  return new Response(file, { headers });
}
