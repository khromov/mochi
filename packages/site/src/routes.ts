import { Mochi, error, getRequestContext, mintCaptcha, verifyCaptcha } from 'mochi-framework';
import type { MochiRouteValue, MochiQueueConfig, MochiCronConfig } from 'mochi-framework';
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
  getPostLlmsTxt,
  internalDemoLlmsRoutes,
  loadDocs,
} from './lib/docs';
import { loadPosts, getPost } from './lib/blog';
import { buildFeedXml, FEED_CONTENT_TYPE } from './lib/feed';
import { CHANGELOG_SLUG, CHANGELOG_TITLE, CHANGELOG_DESCRIPTION, getChangelogHtml, getChangelogTxt } from './lib/changelog';
import { respondMcp } from './lib/mcp';
import Site from './Site.svelte';
import Docs from './Docs.svelte';
import Blog from './Blog.svelte';
import BlogPost from './BlogPost.svelte';
import { profilerEnabled, startProfiler, stopProfiler } from './lib/profiler';
import { routes as apiRoutes } from './demos/api/routes';
import { routes as cacheEventsRoutes } from './demos/cache-events/routes';
import { routes as captchaRoutes } from './demos/captcha/routes';
import { routes as protectionRoutes } from './demos/protection/routes';
import { routes as captchaStylingRoutes } from './demos/captcha-styling/routes';
import { routes as chartsRoutes } from './demos/charts/routes';
import { routes as chatRoutes } from './demos/chat/routes';
import { routes as ciRoutes } from './ci/routes';
import { routes as clientOnlyRoutes } from './demos/client-only/routes';
import { routes as cookieVaryTestRoutes } from './demos/cookie-vary-test/routes';
import { routes as cookiesRoutes } from './demos/cookies/routes';
import { routes as dataLoadingRoutes } from './demos/data-loading/routes';
import { routes as emailRoutes } from './demos/email/routes';
import { routes as entityPropsRoutes } from './demos/entity-props/routes';
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
import { routes as isHydratableRoutes } from './demos/is-hydratable/routes';
import { routes as imageRoutes } from './demos/image/routes';
import { routes as imageInvalidationRoutes } from './demos/image-invalidation/routes';
import { routes as imageEventsRoutes } from './demos/image-events/routes';
import { routes as imagePipelineRoutes } from './demos/image-pipeline/routes';
import { routes as hydrationRoutes } from './demos/hydration/routes';
import { routes as islandPropsRoutes } from './demos/island-props/routes';
import { routes as lazyRoutes } from './demos/lazy/routes';
import { routes as lazyServerIslandRoutes } from './demos/lazy-server-island/routes';
import { routes as leakTestRoutes } from './leak-test/routes';
import { routes as islandDepthRoutes } from './demos/island-depth/routes';
import { routes as loginRoutes } from './demos/login/routes';
import { routes as mdsvexRoutes } from './demos/mdsvex/routes';
import { routes as ogRoutes } from './og/routes';
import { routes as nestedComponentsRoutes } from './demos/nested-components/routes';
import { routes as nestedIslandsRoutes } from './demos/nested-islands/routes';
import { routes as portableTextRoutes } from './demos/portable-text/routes';
import { routes as propDedupRoutes } from './demos/prop-dedup/routes';
import { routes as propsIdRoutes } from './demos/props-id/routes';
import { routes as queueRoutes, queues as queueQueues } from './demos/queue/routes';
import { routes as cronRoutes, cron as cronJobs } from './demos/cron/routes';
import { routes as rateLimitRoutes } from './demos/rate-limit/routes';
import { routes as reloadFormDataRoutes } from './demos/reload-form-data/routes';
import { routes as requestCacheRoutes } from './demos/request-cache/routes';
import { routes as requestIdRoutes } from './demos/request-id/routes';
import { routes as modeWatcherRoutes } from './demos/mode-watcher/routes';
import { routes as runedRoutes } from './demos/runed/routes';
import { routes as serverIslandRoutes } from './demos/server-island/routes';
import { routes as deferInvalidationRoutes } from './demos/defer-invalidation/routes';
import { routes as shotRoutes } from './shot/routes';
import { routes as serverPropsRoutes } from './demos/server-props/routes';
import { routes as sharedStateRoutes } from './demos/shared-state/routes';
import { routes as staticDirsRoutes } from './demos/static-dirs/routes';
import { routes as streamsRoutes } from './demos/streams/routes';
import { routes as tanstackTableRoutes } from './demos/tanstack-table/routes';
import { routes as urlRoutes } from './demos/url/routes';
import { routes as varlockRoutes } from './demos/varlock/routes';
import { routes as viewTransitionsRoutes } from './demos/view-transitions/routes';
import { routes as customTransitionsRoutes } from './demos/custom-transitions/routes';
import { routes as yourFirstMochiAppRoutes } from './demos/your-first-mochi-app/routes';

const DEVELOPMENT = process.env.MODE === 'development';
const HEAP_SNAPSHOTS_ENABLED = process.env.HEAP_SNAPSHOTS_ENABLED === 'true';

// Served by packages/support; NEWSLETTER_EMBED_URL overrides it. The trailing
// slash is required — support is `trailingSlash: 'always'`, so a slashless src
// costs a 308 inside the frame on every blog page view.
const NEWSLETTER_EMBED_URL = process.env.NEWSLETTER_EMBED_URL || (DEVELOPMENT ? 'http://localhost:3336/newsletter/embed/' : 'https://support.mochi.fast/newsletter/embed/');

// Built rather than concatenated so an override that already carries a query
// string doesn't produce `?a=b?src=…`. `src` is what the admin panel attributes
// a signup to.
function newsletterEmbedUrl(src: string): string {
  const url = new URL(NEWSLETTER_EMBED_URL);
  url.searchParams.set('src', src);
  return url.toString();
}

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

// Vanity redirects. These are `Mochi.api()` routes, so the site's `trailingSlash: 'always'`
// never mirrors them onto the alt-slash form — but links to both forms are already published,
// so each form is registered by hand.
const DISCORD_INVITE = 'https://discord.com/invite/QCGfks4gg8';
// The support form lives at support.mochi.fast (packages/support) — it needs an
// SMTP config this site deliberately doesn't carry.
const SUPPORT_ORIGIN = 'https://support.mochi.fast/';
const vanityRedirect = (to: string): MochiRouteValue => Mochi.api(() => Response.redirect(to, 302));
const discordRoute = vanityRedirect(DISCORD_INVITE);
const supportRoute = vanityRedirect(SUPPORT_ORIGIN);
// Same reasoning for the MCP endpoint: /mcp is what we advertise, but clients that
// normalise the configured URL to /mcp/ would otherwise hit an unregistered path.
const mcpRoute = Mochi.api(({ request }) => respondMcp(request));

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
  // On-demand V8 heap snapshot for memory-leak debugging. A full heap dump can
  // contain anything the process has touched, so it stays unregistered unless
  // explicitly opted into via HEAP_SNAPSHOTS_ENABLED=true (see memtest/).
  ...(HEAP_SNAPSHOTS_ENABLED
    ? {
        '/_heapsnapshot': Mochi.api(() => {
          const snapshot = Bun.generateHeapSnapshot('v8');
          const filename = `mochi-${Date.now()}.heapsnapshot`;
          return new Response(snapshot, {
            headers: {
              'Content-Type': 'application/json',
              'Content-Disposition': `attachment; filename="${filename}"`,
            },
          });
        }),
      }
    : {}),
  '/discord': discordRoute,
  '/discord/': discordRoute,
  '/': Mochi.page(Site, {
    serverProps: async () => {
      const docs = await loadDocs();
      return {
        docsNav: await buildDocsNav(),
        firstDocSlug: docs[0]?.slug ?? 'intro',
      };
    },
  }),
  // Static, so it outranks /docs/:slug below. The changelog is a synthetic doc rendered
  // from markdown fetched at runtime — it can't ride the build-time docComponents barrel,
  // so it hands Docs.svelte pre-rendered HTML instead of a component.
  '/docs/changelog': Mochi.page(Docs, {
    serverProps: async () => {
      const html = await getChangelogHtml();
      if (html === null) {
        error(503, 'Changelog is temporarily unavailable');
      }
      return {
        slug: CHANGELOG_SLUG,
        title: CHANGELOG_TITLE,
        description: CHANGELOG_DESCRIPTION,
        docsNav: await buildDocsNav(),
        // No on-page TOC: it would just be a second copy of the version list the page
        // already is. No pager either — the changelog sits outside the docs sequence.
        toc: [],
        html,
        prev: null,
        next: null,
      };
    },
  }),
  '/docs/:slug': Mochi.page(Docs, {
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
  '/blog': Mochi.page(Blog, {
    serverProps: async () => {
      const posts = await loadPosts({ includeDrafts: DEVELOPMENT });
      return {
        docsNav: await buildDocsNav(),
        posts: posts.map(({ slug, title, description, date, draft }) => ({ slug, title, description, date, draft })),
        newsletterEmbedUrl: newsletterEmbedUrl('blog-index'),
      };
    },
  }),
  '/blog/:slug': Mochi.page(BlogPost, {
    serverProps: async () => {
      const { params } = getRequestContext();
      const slug = params.slug ?? '';
      const post = await getPost(slug, { includeDrafts: DEVELOPMENT });
      if (!post) {
        error(404, `No post '${slug}'`);
      }
      return {
        slug: post.slug,
        title: post.title,
        description: post.description,
        date: post.date,
        draft: post.draft,
        author: post.author,
        docsNav: await buildDocsNav(),
        newsletterEmbedUrl: newsletterEmbedUrl(post.slug),
      };
    },
  }),
  '/support': supportRoute,
  '/support/': supportRoute,
  // Backs the live captcha embedded in the 0.8.0 blog post. Minting and verifying
  // happen here rather than in `/blog/:slug` so that route stays post-agnostic.
  '/api/captcha-demo/mint': Mochi.api(() => Response.json(mintCaptcha()), { rateLimit: { limit: 60, window: '1m' } }),
  '/api/captcha-demo/verify': Mochi.api(
    async ({ method, request }) => {
      if (method !== 'POST') {
        error(405, 'Method Not Allowed');
      }
      const { token, pow } = (await request.json()) as { token?: string; pow?: string };
      const formData = new FormData();
      formData.set('captcha_token', String(token ?? ''));
      formData.set('captcha_pow', String(pow ?? ''));
      return Response.json(await verifyCaptcha(formData));
    },
    { rateLimit: { limit: 30, window: '1m' } },
  ),
  '/sitemap.xml': Mochi.api(async () => {
    return new Response(await buildSitemapXml(), {
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  }),
  '/feed.xml': Mochi.api(async () => {
    return new Response(await buildFeedXml(), {
      headers: { 'Content-Type': FEED_CONTENT_TYPE },
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
  // Static, so it outranks the /docs/:slug/llms.txt param route below (same
  // specificity rule the demoLlmsRoutes block relies on). The changelog is a
  // synthetic doc fetched from GitHub — a null means the fetch failed, so 503
  // (not 404): the entry is always listed, only the upstream can be unavailable.
  '/docs/changelog/llms.txt': Mochi.api(async () => {
    const text = await getChangelogTxt();
    if (text === null) {
      error(503, 'Changelog is temporarily unavailable');
    }
    return new Response(text, {
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
  '/blog/:slug/llms.txt': Mochi.api(async () => {
    const { params } = getRequestContext();
    const slug = params.slug ?? '';
    const text = await getPostLlmsTxt(slug);
    if (text === null) {
      error(404, `No post '${slug}'`);
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
  '/mcp': mcpRoute,
  '/mcp/': mcpRoute,
  ...demoLlmsRoutes,
  ...apiRoutes,
  ...cacheEventsRoutes,
  ...captchaRoutes,
  ...protectionRoutes,
  ...captchaStylingRoutes,
  ...chartsRoutes,
  ...chatRoutes,
  ...ciRoutes,
  ...ogRoutes,
  ...clientOnlyRoutes,
  ...cookieVaryTestRoutes,
  ...cookiesRoutes,
  ...dataLoadingRoutes,
  ...emailRoutes,
  ...entityPropsRoutes,
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
  ...isHydratableRoutes,
  ...imageRoutes,
  ...imageInvalidationRoutes,
  ...imageEventsRoutes,
  ...imagePipelineRoutes,
  ...hydrationRoutes,
  ...islandPropsRoutes,
  ...lazyRoutes,
  ...lazyServerIslandRoutes,
  ...(DEVELOPMENT ? leakTestRoutes : {}),
  ...islandDepthRoutes,
  ...loginRoutes,
  ...mdsvexRoutes,
  ...nestedComponentsRoutes,
  ...nestedIslandsRoutes,
  ...portableTextRoutes,
  ...propDedupRoutes,
  ...propsIdRoutes,
  ...queueRoutes,
  ...cronRoutes,
  ...rateLimitRoutes,
  ...reloadFormDataRoutes,
  ...requestCacheRoutes,
  ...requestIdRoutes,
  ...modeWatcherRoutes,
  ...runedRoutes,
  ...serverIslandRoutes,
  ...deferInvalidationRoutes,
  ...serverPropsRoutes,
  ...shotRoutes,
  ...sharedStateRoutes,
  ...staticDirsRoutes,
  ...streamsRoutes,
  ...tanstackTableRoutes,
  ...urlRoutes,
  ...varlockRoutes,
  ...viewTransitionsRoutes,
  ...customTransitionsRoutes,
  ...yourFirstMochiAppRoutes,
};

// Background job queues, mounted in Mochi.serve({ queues }) (see src/index.ts).
export const queues: MochiQueueConfig[] = [...queueQueues];

// Scheduled jobs, mounted in Mochi.serve({ cron }) (see src/index.ts).
export const cron: MochiCronConfig[] = [...cronJobs];
