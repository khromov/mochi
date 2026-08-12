import { Mochi, error } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { getOgCard, ogCacheKey } from './cache.ts';
import { resolveOgSubject } from './resolve.ts';

/** Extension is required: it's what keeps `trailingSlash: 'always'` from redirecting a crawler. */
const EXTENSION = '.jpg';

const DEVELOPMENT = process.env.MODE === 'development';

export const routes: Record<string, MochiRouteValue> = {
  '/og': Mochi.page('./src/og/OgPage.svelte', {
    serverProps: () => ({
      samples: [
        { label: 'Home', src: '/og/index.jpg' },
        { label: 'Docs', src: '/og/docs/defining-routes.jpg' },
        { label: 'Demo', src: '/og/demos/hello-world.jpg' },
      ],
    }),
  }),

  // Mirrors the canonical path of the page it represents, so `mergeMetaTags` derives the URL without
  // any page needing to know its own kind. A wildcard because Bun's router only binds whole
  // segments, so `:slug.jpg` can't be expressed as a pattern.
  '/og/*': Mochi.api(
    async ({ request, url }) => {
      // Bun matches the wildcard but exposes no param for it, so the tail comes off the pathname.
      const rest = url.pathname.slice('/og'.length);
      if (!rest.endsWith(EXTENSION)) {
        error(404, 'Not Found');
      }

      const subject = await resolveOgSubject(rest.slice(0, -EXTENSION.length));
      if (!subject) {
        error(404, `No page for OG card '${rest}'`);
      }

      // The tag is a hash of the subject and the renderer version, so a revalidation can be answered
      // without touching the cache or the canvas at all. Neither it nor the max-age survives into
      // development, where the drawing code changes under a stable subject on every edit.
      const etag = `"${ogCacheKey(subject)}"`;
      const headers = DEVELOPMENT
        ? { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }
        : { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800', ETag: etag };
      if (!DEVELOPMENT && request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers });
      }

      return new Response(await getOgCard(subject), { headers });
    },
    { rateLimit: { limit: 120, window: '1m' } },
  ),
};
