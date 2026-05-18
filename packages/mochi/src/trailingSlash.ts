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
