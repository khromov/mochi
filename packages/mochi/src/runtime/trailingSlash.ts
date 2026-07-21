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

/**
 * Removes trailing forward slashes if they exist.
 *
 * If the string doesn't end with a slash, we simply return it.
 */
function unTrailingSlashIt(str: string): string {
  if (str.endsWith('/') || str.endsWith('\\')) {
    return unTrailingSlashIt(str.slice(0, -1));
  }

  return str;
}

/**
 * Appends a trailing slash to the path portion of a string.
 *
 * Strips any slash the path already ends with first, so the result is never
 * double-slashed. A query string or `#fragment` is split off, left untouched,
 * and re-attached after the path so the slash always lands on the path itself.
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
