import { Mochi, error } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { getOgCard, ogCacheKey } from './cache.ts';
import { resolveOgSubject } from './resolve.ts';

/** Extension is required: it's what keeps `trailingSlash: 'always'` from redirecting a crawler. */
const EXTENSION = '.jpg';

const IS_DOCKER = process.env.MOCHI_DOCKER === 'true';

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

  // A wildcard because Bun's router only binds whole segments, so `:slug.jpg` is not expressible.
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

      const etag = `"${ogCacheKey(subject)}"`;
      const headers: Record<string, string> = IS_DOCKER
        ? { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800', ETag: etag }
        : { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' };
      if (IS_DOCKER && request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers });
      }

      return new Response(await getOgCard(subject), { headers });
    },
    { rateLimit: { limit: 120, window: '1m' } },
  ),
};
