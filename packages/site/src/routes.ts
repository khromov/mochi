import { Mochi, error, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue, MochiQueueConfig } from 'mochi-framework';
import {
  buildDocsNav,
  buildLlmsJson,
  buildLlmsIndexTxt,
  buildLlmsRecommendedTxt,
  buildLlmsFullTxt,
  buildSitemapXml,
  getDemoLlmsTxt,
  getDoc,
  getDocLlmsTxt,
  getDocNeighbors,
  internalDemoLlmsRoutes,
  loadDocs,
} from './lib/docs';
import { respondMcp } from './lib/mcp';
import { profilerEnabled, startProfiler, stopProfiler } from './lib/profiler';
import { routes as apiRoutes } from './demos/api/routes';
import { routes as cacheEventsRoutes } from './demos/cache-events/routes';
import { routes as chatRoutes } from './demos/chat/routes';
import { routes as cookieVaryTestRoutes } from './demos/cookie-vary-test/routes';
import { routes as cookiesRoutes } from './demos/cookies/routes';
import { routes as dataLoadingRoutes } from './demos/data-loading/routes';
import { routes as errorRoutes } from './demos/error/routes';
import { routes as errorBoundariesRoutes } from './demos/error-boundaries/routes';
import { routes as fileRoutes } from './demos/file/routes';
import { routes as fileUploadRoutes } from './demos/file-upload/routes';
import { routes as fontLoadingRoutes } from './demos/font-loading/routes';
import { routes as formCancelRoutes } from './demos/form-cancel/routes';
import { routes as formErrorsRoutes } from './demos/form-errors/routes';
import { routes as formRedirectsRoutes } from './demos/form-redirects/routes';
import { routes as formReturnDataRoutes } from './demos/form-return-data/routes';
import { routes as helloWorldRoutes } from './demos/hello-world/routes';
import { routes as hydratableRoutes } from './demos/hydratable/routes';
import { routes as hydrationRoutes } from './demos/hydration/routes';
import { routes as islandPropsRoutes } from './demos/island-props/routes';
import { routes as lazyRoutes } from './demos/lazy/routes';
import { routes as lazyServerIslandRoutes } from './demos/lazy-server-island/routes';
import { routes as leakTestRoutes } from './leak-test/routes';
import { routes as loginRoutes } from './demos/login/routes';
import { routes as mdsvexRoutes } from './demos/mdsvex/routes';
import { routes as nestedComponentsRoutes } from './demos/nested-components/routes';
import { routes as nestedIslandsRoutes } from './demos/nested-islands/routes';
import { routes as propDedupRoutes } from './demos/prop-dedup/routes';
import { routes as propsIdRoutes } from './demos/props-id/routes';
import { routes as queueRoutes, queues as queueQueues } from './demos/queue/routes';
import { routes as reloadFormDataRoutes } from './demos/reload-form-data/routes';
import { routes as requestIdRoutes } from './demos/request-id/routes';
import { routes as serverIslandRoutes } from './demos/server-island/routes';
import { routes as serverPropsRoutes } from './demos/server-props/routes';
import { routes as sharedStateRoutes } from './demos/shared-state/routes';
import { routes as streamsRoutes } from './demos/streams/routes';
import { routes as urlRoutes } from './demos/url/routes';
import { routes as viewTransitionsRoutes } from './demos/view-transitions/routes';
import { routes as customTransitionsRoutes } from './demos/custom-transitions/routes';
import { routes as yourFirstMochiAppRoutes } from './demos/your-first-mochi-app/routes';

const DEVELOPMENT = process.env.MODE === 'development';

// Static per-demo source routes, sitting alongside each demo page (e.g.
// /demos/chat/llms.txt, /cookie-vary-test/llms.txt). Static (not a param) so they
// outrank demo param routes such as /demos/data-loading/:id, which would otherwise
// capture "llms.txt".
const demoLlmsRoutes: Record<string, MochiRouteValue> = Object.fromEntries(
  internalDemoLlmsRoutes().map(({ path, slug }) => [
    path,
    Mochi.api(async () => {
      const text = await getDemoLlmsTxt(slug);
      if (text === null) {
        error(404, `No demo '${slug}'`);
      }
      return new Response(text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }),
  ]),
);

export const routes: Record<string, MochiRouteValue> = {
  ...(DEVELOPMENT
    ? {
        '/_profiler/start': Mochi.api(async () => {
          if (!profilerEnabled()) {
            return new Response('Not Found', { status: 404 });
          }
          await startProfiler();
          return Response.json({ ok: true });
        }),
        '/_profiler/stop': Mochi.api(async () => {
          if (!profilerEnabled()) {
            return new Response('Not Found', { status: 404 });
          }
          const profile = await stopProfiler();
          return Response.json(profile);
        }),
      }
    : {}),
  '/discord': Mochi.api(() => Response.redirect('https://discord.com/invite/QCGfks4gg8', 302)),
  '/': Mochi.page('./src/Site.svelte', {
    serverProps: async () => {
      const docs = await loadDocs();
      return {
        docsNav: await buildDocsNav(),
        firstDocSlug: docs[0]?.slug ?? 'intro',
      };
    },
  }),
  '/docs/:slug': Mochi.page('./src/Docs.svelte', {
    serverProps: async () => {
      const { params } = getRequestContext();
      const slug = params.slug ?? '';
      const doc = await getDoc(slug);
      if (!doc) {
        error(404, `No doc '${slug}'`);
      }
      const { prev, next } = await getDocNeighbors(doc.slug);
      return {
        slug: doc.slug,
        title: doc.title,
        description: doc.description,
        docsNav: await buildDocsNav(),
        toc: doc.toc,
        prev,
        next,
      };
    },
  }),
  '/og': Mochi.page('./src/og/OgPage.svelte'),
  '/sitemap.xml': Mochi.api(async () => {
    return new Response(await buildSitemapXml(), {
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  }),
  '/llms.txt': Mochi.api(async () => {
    const { url } = getRequestContext();
    return new Response(await buildLlmsIndexTxt(url.origin), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }),
  '/llms-recommended.txt': Mochi.api(async () => {
    return new Response(await buildLlmsRecommendedTxt(), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }),
  '/llms-full.txt': Mochi.api(async () => {
    return new Response(await buildLlmsFullTxt(), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }),
  '/docs/:slug/llms.txt': Mochi.api(async () => {
    const { params } = getRequestContext();
    const slug = params.slug ?? '';
    const text = await getDocLlmsTxt(slug);
    if (text === null) {
      error(404, `No doc '${slug}'`);
    }
    return new Response(text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }),
  '/llms.json': Mochi.api(async () => {
    const { url } = getRequestContext();
    return Response.json(await buildLlmsJson(url.origin));
  }),
  '/SKILL.md': Mochi.file('./src/SKILL.md'),
  '/mcp': Mochi.api(({ request }) => respondMcp(request)),
  ...demoLlmsRoutes,
  ...apiRoutes,
  ...cacheEventsRoutes,
  ...chatRoutes,
  ...cookieVaryTestRoutes,
  ...cookiesRoutes,
  ...dataLoadingRoutes,
  ...errorRoutes,
  ...errorBoundariesRoutes,
  ...fileRoutes,
  ...fileUploadRoutes,
  ...fontLoadingRoutes,
  ...formCancelRoutes,
  ...formErrorsRoutes,
  ...formRedirectsRoutes,
  ...formReturnDataRoutes,
  ...helloWorldRoutes,
  ...hydratableRoutes,
  ...hydrationRoutes,
  ...islandPropsRoutes,
  ...lazyRoutes,
  ...lazyServerIslandRoutes,
  ...(DEVELOPMENT ? leakTestRoutes : {}),
  ...loginRoutes,
  ...mdsvexRoutes,
  ...nestedComponentsRoutes,
  ...nestedIslandsRoutes,
  ...propDedupRoutes,
  ...propsIdRoutes,
  ...queueRoutes,
  ...reloadFormDataRoutes,
  ...requestIdRoutes,
  ...serverIslandRoutes,
  ...serverPropsRoutes,
  ...sharedStateRoutes,
  ...streamsRoutes,
  ...urlRoutes,
  ...viewTransitionsRoutes,
  ...customTransitionsRoutes,
  ...yourFirstMochiAppRoutes,
};

// Background job queues, mounted in Mochi.serve({ queues }) (see src/index.ts).
export const queues: Record<string, MochiQueueConfig> = {
  ...queueQueues,
};
