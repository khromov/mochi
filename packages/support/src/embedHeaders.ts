import type { Handle } from 'mochi-framework';
import { isSupportDev } from './devMode';

export const NEWSLETTER_EMBED_PATH = '/newsletter/embed';

const PRODUCTION_ANCESTORS = 'https://mochi.fast https://www.mochi.fast';
const DEVELOPMENT_ANCESTORS = 'http://localhost:3333 http://localhost:4444';

// Env is a parameter rather than a module-load read so a test can vary it without patching the process-wide one. The
// guest's postMessage listener authorises against this same list, so the two can't drift: whoever may frame the widget
// is exactly whoever may talk to it.
export function embedAncestors(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.NEWSLETTER_EMBED_ANCESTORS?.trim();
  const ancestors = configured || (isSupportDev(env) ? `${PRODUCTION_ANCESTORS} ${DEVELOPMENT_ANCESTORS}` : PRODUCTION_ANCESTORS);
  return ancestors.split(/\s+/).filter(Boolean);
}

// Everything but the embed refuses framing, since a clickjacked /admin/ POST carries our own Origin and passes CSRF; the
// embed skips X-Frame-Options, which can't express its cross-origin allow-list.
// The response is rebuilt because `filterResponseHeaders` can only drop headers, never add one.
export const embedHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (event.kind === 'asset') {
    return response;
  }
  const { pathname } = event.url;
  const headers = new Headers(response.headers);
  if (pathname === NEWSLETTER_EMBED_PATH || pathname.startsWith(`${NEWSLETTER_EMBED_PATH}/`)) {
    headers.set('Content-Security-Policy', `frame-ancestors 'self' ${embedAncestors().join(' ')}`);
    headers.set('X-Robots-Tag', 'noindex');
  } else {
    headers.set('Content-Security-Policy', "frame-ancestors 'none'");
    headers.set('X-Frame-Options', 'DENY');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
