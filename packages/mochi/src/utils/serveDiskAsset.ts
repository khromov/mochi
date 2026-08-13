/**
 * Response builder shared by every registered disk-backed asset route (extracted fonts, locally-imported images), so
 * serving policy lives in one place. An unregistered URL or a registered one whose file is gone (wiped outDir under a
 * live server, partially copied build) is a 404, not the 500 Bun.file's lazy ENOENT would surface as. Registered names
 * are content-hashed, so production marks them immutable while dev omits caching and replacements appear on the next
 * request.
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
