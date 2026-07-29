import type { Handle } from 'mochi-framework';

/** Also the analytics exclusion in index.ts — the embed must not report a pageview per blog view. */
export const NEWSLETTER_EMBED_PATH = '/newsletter/embed';

const PRODUCTION_ANCESTORS = 'https://mochi.fast https://www.mochi.fast';

// The dev site runs on 3333, and the smoke-test convention in CLAUDE.md puts a
// second one on 4444.
const DEVELOPMENT_ANCESTORS = 'http://localhost:3333 http://localhost:4444';

/**
 * Frames the newsletter embed to the sites allowed to host it.
 *
 * No `X-Frame-Options`: it can only say "same origin" or "nobody", which is
 * useless for a widget whose entire job is to be embedded cross-origin, and
 * `frame-ancestors` supersedes it wherever both are understood.
 *
 * The header is set by rebuilding the response rather than through
 * `resolve(event, …)`: `filterResponseHeaders` is a keep/drop predicate, so
 * there is no hook for adding one.
 */
export const embedHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (!event.url.pathname.startsWith(NEWSLETTER_EMBED_PATH)) {
    return response;
  }
  const configured = process.env.NEWSLETTER_EMBED_ANCESTORS?.trim();
  const ancestors = configured || (process.env.MODE === 'development' ? `${PRODUCTION_ANCESTORS} ${DEVELOPMENT_ANCESTORS}` : PRODUCTION_ANCESTORS);
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', `frame-ancestors 'self' ${ancestors}`);
  // The widget is meant to be found through the blog, never as a search result.
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
