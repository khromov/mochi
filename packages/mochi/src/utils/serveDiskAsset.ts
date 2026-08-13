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
