import type { Handle } from 'mochi-framework';

export const NEWSLETTER_EMBED_PATH = '/newsletter/embed';

const PRODUCTION_ANCESTORS = 'https://mochi.fast https://www.mochi.fast';
const DEVELOPMENT_ANCESTORS = 'http://localhost:3333 http://localhost:4444';

// No X-Frame-Options: it can't express an allow-list, which is the whole point
// for a widget meant to be embedded cross-origin. The response is rebuilt because
// `filterResponseHeaders` can only drop headers, never add one.
export const embedHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (!event.url.pathname.startsWith(NEWSLETTER_EMBED_PATH)) {
    return response;
  }
  const configured = process.env.NEWSLETTER_EMBED_ANCESTORS?.trim();
  const ancestors = configured || (process.env.MODE === 'development' ? `${PRODUCTION_ANCESTORS} ${DEVELOPMENT_ANCESTORS}` : PRODUCTION_ANCESTORS);
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', `frame-ancestors 'self' ${ancestors}`);
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
