import path from 'node:path';
import { compile as mdsvexCompile } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import rehypeExternalLinks from './lib/rehypeExternalLinks';
import { Mochi, mochiEvents, sequence, logger, noCache, compress, silenceInternalRoutes, error, getRequestContext } from 'mochi-framework';
import type { Handle, HandleError, MarkdownConfig, MochiRouteValue } from 'mochi-framework';
import { generateDocsBarrel } from './lib/generateDocsBarrel';
import { buildDocsNav, buildLlmsTxt, buildLlmsFullTxt, buildSitemapXml, clearDocsCaches, DOCS_DIR, getDoc, getDocLlmsTxt, getDocNeighbors, loadDocs } from './lib/docs';
import { highlightCode } from './lib/highlight.server';
import { profilerEnabled, startProfiler, stopProfiler } from './lib/profiler';
import { routes as apiRoutes } from './demos/api/routes';
import { routes as cacheEventsRoutes } from './demos/cache-events/routes';
import { routes as chatRoutes } from './demos/chat/routes';
import { handle as cookieVaryTestHandle, routes as cookieVaryTestRoutes } from './demos/cookie-vary-test/routes';
import { routes as cookiesRoutes } from './demos/cookies/routes';
import { routes as dataLoadingRoutes } from './demos/data-loading/routes';
import { routes as errorRoutes } from './demos/error/routes';
import { routes as errorBoundariesRoutes } from './demos/error-boundaries/routes';
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
import { routes as propDedupRoutes } from './demos/prop-dedup/routes';
import { routes as reloadFormDataRoutes } from './demos/reload-form-data/routes';
import { routes as serverIslandRoutes } from './demos/server-island/routes';
import { routes as serverPropsRoutes } from './demos/server-props/routes';
import { routes as sharedStateRoutes } from './demos/shared-state/routes';
import { routes as streamsRoutes } from './demos/streams/routes';
import { routes as urlRoutes } from './demos/url/routes';
import { routes as yourFirstMochiAppRoutes } from './demos/your-first-mochi-app/routes';

const IS_DOCKER = process.env.MOCHI_DOCKER === 'true';
const immutableAssets: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (IS_DOCKER && event.kind === 'asset') {
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  return response;
};

if (process.env.MODE === 'development') {
  await generateDocsBarrel();

  const docsDirPrefix = DOCS_DIR + path.sep;
  mochiEvents.setHandler('docs-cache-clear', 'file:change', async ({ path: changed }) => {
    if (changed.startsWith(docsDirPrefix) && changed.endsWith('.md')) {
      clearDocsCaches();
      await generateDocsBarrel();
    }
  });
}

const handleError: HandleError = ({ error, event, status, message }) => {
  if (!event.url.pathname.includes('.well-known')) {
    logger.info(`handleError: ${event.url.pathname} → ${status} "${message}" (error ${error ? 'present' : 'null'})`);
  }
  // error is null for unmatched routes / unknown form actions — guard before forwarding
  if (error && status >= 500) {
    logger.error('app:', event.url.pathname, error);
  }
  // Short-circuit: redirect this specific demo path instead of rendering the error page
  if (event.url.pathname === '/demos/error/redirect/') {
    return Response.redirect(new URL('/demos/error', event.url), 302);
  }
};

const helloWorld: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set('X-Mochi', 'Hello World! :)');
  return response;
};

const asciiDog: Handle = async ({ event, resolve }) => {
  return resolve(event, {
    transformPage({ html }) {
      const dog = `
<!--
Hello from Mochi! Inserted via transformPage
⠀⠀⠀⠀⠀⠀⢀⣀⣀⣀⣀⣀⣀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⢀⡤⠞⠋⠉⠀⠀⠀⠀⠀⠀⠀⠉⠙⠳⢄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⣠⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠱⡆⠀⠀⠀⠀⠀⠀⠀⠀
⢠⠇⠀⢰⠆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠰⡄⠀⢸⡀
⢸⠀⠀⢸⠀⠀⢰⣶⡀⠀⠀⠀⢠⣶⡀⠀⠀⡇⠀⢸⠂⠀⠀⠀⠀⠀⠀⠀
⠈⢧⣀⢸⡄⠀⠀⠉⠀⠀⠀⠀⠀⠉⠀⠀⢠⡇⣠⡞⠁⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠉⠙⣇⠀⠂⠀⠀⢶⣶⣶⠀⠄⠀⠀⣾⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠘⢦⡀⠀⠀⠀⠀⠀⠀⠀⢀⣼⡁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢠⠞⠓⠤⣤⣀⣀⣠⣤⠴⠚⠉⠑⠲⢤⡀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢸⠀⠀⣀⣠⣀⣀⣠⣀⡀⠀⠀⠀⠀⠀⠈⠳⣄⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢸⠀⠰⡇⠀⠈⠁⠀⠈⡧⠀⠀⠀⠀⠀⠀⠀⠈⢦⠀⠀⢠⠖⡆
⠀⠀⠀⠀⢸⠀⠀⠑⢦⡀⠀⣠⠞⠁⠀⢸⠀⠀⠀⠀⠀⠀⠈⣷⠞⠋⢠⠇
⠀⠀⠀⠀⢸⠀⠀⠀⠀⠙⡞⠁⠀⠀⠀⢸⠀⠀⠀⠀⠀⠀⠀⢹⢀⡴⠋⠀
⠀⠀⠀⠀⢸⠀⠀⠀⠀⠀⡇⠀⠀⠀⠀⢸⠀⠀⠀⠀⠀⠀⠀⡞⠉⠀⠀⠀
⠀⠀⠀⠀⢸⡀⠀⠀⠀⢠⣧⠀⠀⠀⠀⣸⡀⠀⠀⠀⠀⣠⠞⠁⠀⠀⠀⠀
⠀⠀⠀⠀⠈⠳⠦⠤⠴⠛⠈⠓⠤⠤⠞⠁⠉⠛⠒⠚⠋⠁⠀⠀⠀⠀⠀⠀
-->`;
      return html.replace('{{mochi.dog}}', dog);
    },
  });
};

const ANALYTICS_SCRIPT = `<script defer src="https://u.khromov.se/u.js" data-website-id="8dceb8f5-6533-4c03-9cd6-1ce74accd63a"></script>`;
const analytics: Handle = async ({ event, resolve }) => {
  return resolve(event, {
    transformPage({ html }) {
      return html.replace('{{mochi.analytics}}', IS_DOCKER ? ANALYTICS_SCRIPT : '');
    },
  });
};

const PORT = Number(process.env.PORT) || 3333;
const CSRF_PORT = Number(process.env.MOCHI_PORT) || 3333;
const CSRF_DOMAIN = process.env.MOCHI_DOMAIN ?? 'localhost';
const CSRF_PROTOCOL = CSRF_PORT === 443 ? 'https' : 'http';
const origin = CSRF_DOMAIN.includes('://') ? CSRF_DOMAIN : `${CSRF_PROTOCOL}://${CSRF_DOMAIN}:${CSRF_PORT}`;

const DEVELOPMENT = process.env.MODE === 'development';

const markdownConfig: MarkdownConfig = {
  compile: mdsvexCompile,
  rehypePlugins: [rehypeSlug, rehypeExternalLinks],
  highlight: { highlighter: (code, lang) => highlightCode(code, lang) },
};

const routes: Record<string, MochiRouteValue> = {
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
    return new Response(await buildLlmsTxt(), {
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
  ...apiRoutes,
  ...cacheEventsRoutes,
  ...chatRoutes,
  ...cookieVaryTestRoutes,
  ...cookiesRoutes,
  ...dataLoadingRoutes,
  ...errorRoutes,
  ...errorBoundariesRoutes,
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
  ...propDedupRoutes,
  ...reloadFormDataRoutes,
  ...serverIslandRoutes,
  ...serverPropsRoutes,
  ...sharedStateRoutes,
  ...streamsRoutes,
  ...urlRoutes,
  ...yourFirstMochiAppRoutes,
};

await Mochi.serve({
  port: PORT,
  development: DEVELOPMENT,
  liveReload: process.env.MOCHI_LIVE_RELOAD === 'false' ? false : undefined,
  htmlShell: './src/shell.html',
  trailingSlash: 'always',
  handle: sequence(compress(), immutableAssets, helloWorld, asciiDog, analytics, noCache, cookieVaryTestHandle),
  handleError,
  idleTimeout: 60,
  compressServerIslandProps: true,
  // ThemeToggle uses a `class:compact` shorthand on a folded prop, which
  // svelte-shaker v0.2.0 mis-transforms — exclude it so it compiles unshaken.
  // `mochi-framework build` reads this option straight from here (the single
  // source of truth); `report` drives the per-component size breakdown logged at
  // build and is inert at runtime (runtime only shakes on a no-manifest start).
  optimizeWithSvelteShaker: { exclude: ['src/components/ThemeToggle.svelte'], report: true },
  warmup: true,
  additionalWatchPaths: ['../docs'],
  logger: { level: 'log' },
  proxy: { origin }, // TODO: This is a bit of an awkward way to set the allowed csrf domain...
  markdown: markdownConfig,
  eventHooks: {
    'mochi:init': ({ options }) => {
      logger.info(`init: starting on port ${options.port}`);
    },
  },
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
  },
  routes,
});

logger.info('Server running at ' + origin);
