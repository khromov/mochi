export type TrailingSlashPolicy = 'always' | 'never';

const HAS_EXTENSION = /\.[^./]+$/;

export function trailingSlashRedirect(method: string, url: URL, policy: TrailingSlashPolicy): Response | null {
  const { pathname } = url;
  if (pathname === '/' || HAS_EXTENSION.test(pathname)) {
    return null;
  }

  const has = pathname.endsWith('/');
  if (policy === 'never' && has) {
    return permanentRedirect(method, pathname.slice(0, -1) + url.search);
  }
  if (policy === 'always' && !has) {
    return permanentRedirect(method, pathname + '/' + url.search);
  }
  return null;
}

function unTrailingSlashIt(str: string): string {
  if (str.endsWith('/') || str.endsWith('\\')) {
    return unTrailingSlashIt(str.slice(0, -1));
  }

  return str;
}

/**
 * Appends a trailing slash to the path portion of a string, stripping any slash already there so the result never
 * doubles up. A query string or `#fragment` is split off, left untouched, and re-attached, so the slash lands on the path.
 */
export function trailingSlashIt(str: string): string {
  const boundary = str.search(/[?#]/);
  if (boundary === -1) {
    return unTrailingSlashIt(str) + '/';
  }
  return unTrailingSlashIt(str.slice(0, boundary)) + '/' + str.slice(boundary);
}

export function alternateSlashPattern(pattern: string): string | null {
  if (pattern === '/') {
    return null;
  }
  if (HAS_EXTENSION.test(pattern)) {
    return null;
  }
  return pattern.endsWith('/') ? pattern.slice(0, -1) : pattern + '/';
}

function permanentRedirect(method: string, location: string): Response {
  const status = method === 'GET' || method === 'HEAD' ? 301 : 308;
  return new Response(null, { status, headers: { Location: location } });
}
