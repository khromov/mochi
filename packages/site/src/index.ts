import path from 'node:path';
import { compile as mdsvexCompile } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import rehypeExternalLinks from './lib/rehypeExternalLinks';
import { Mochi, mochiEvents, sequence, logger, noCache, compress, silenceInternalRoutes } from 'mochi-framework';
import type { Handle, HandleError, MarkdownConfig } from 'mochi-framework';
import { analytics } from 'mochi-shared';
import { generateDocsBarrel } from './lib/generateDocsBarrel';
import { generateBlogBarrel } from './lib/generateBlogBarrel';
import { clearDocsCaches, DOCS_DIR } from './lib/docs';
import { clearBlogCaches, BLOG_DIR } from './lib/blog';
import { highlightCode } from './lib/highlight.server';
import { handle as cookieVaryTestHandle } from './demos/cookie-vary-test/routes';
import { handle as shotHandle } from './shot/routes';
import { encodeDebugBarGlobals } from './lib/debugBarEncode';
import { routes, queues } from './routes';

const DEVELOPMENT = process.env.MODE === 'development';
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
  await generateBlogBarrel();

  const docsDirPrefix = DOCS_DIR + path.sep;
  mochiEvents.setHandler('docs-cache-clear', 'file:change', async ({ path: changed }) => {
    if (changed.startsWith(docsDirPrefix) && changed.endsWith('.md')) {
      clearDocsCaches();
      await generateDocsBarrel();
    }
  });

  const blogDirPrefix = BLOG_DIR + path.sep;
  mochiEvents.setHandler('blog-cache-clear', 'file:change', async ({ path: changed }) => {
    if (changed.startsWith(blogDirPrefix) && changed.endsWith('.md')) {
      clearBlogCaches();
      // The sitemap cache lives with the docs caches and includes blog URLs.
      clearDocsCaches();
      await generateBlogBarrel();
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

// Re-encodes the debug bar's inlined file paths so crawlers can't mine them as phantom URLs.
// See packages/site/src/lib/debugBarEncode.ts for the why; debugBarEncode.test.ts guards the match.
const encodeDebugBarPaths: Handle = async ({ event, resolve }) => {
  if (!DEVELOPMENT) {
    return resolve(event);
  }
  return resolve(event, {
    transformPage({ html }) {
      const { html: out, matched } = encodeDebugBarGlobals(html);
      // The match is coupled to the framework's exact `<script>window.X=…` emission. If a debug
      // global is present but nothing matched, the format drifted and phantom URLs are leaking
      // again — surface it loudly rather than silently regressing.
      if (matched === 0 && html.includes('__mochi_debug')) {
        logger.warn('encodeDebugBarPaths: debug globals present but none matched — phantom-URL guard is no longer effective');
      }
      return out;
    },
  });
};

const PORT = Number(process.env.PORT) || 3333;
const CSRF_PORT = Number(process.env.MOCHI_PORT) || 3333;
const CSRF_DOMAIN = process.env.MOCHI_DOMAIN ?? 'localhost';
const CSRF_PROTOCOL = CSRF_PORT === 443 ? 'https' : 'http';
const origin = CSRF_DOMAIN.includes('://') ? CSRF_DOMAIN : `${CSRF_PROTOCOL}://${CSRF_DOMAIN}:${CSRF_PORT}`;

const markdownConfig: MarkdownConfig = {
  compile: mdsvexCompile,
  rehypePlugins: [rehypeSlug, rehypeExternalLinks],
  highlight: { highlighter: (code, lang) => highlightCode(code, lang) },
};

await Mochi.serve({
  port: PORT,
  development: DEVELOPMENT,
  liveReload: process.env.MOCHI_LIVE_RELOAD === 'false' ? false : undefined,
  htmlShell: './src/shell.html',
  trailingSlash: 'always',
  handle: sequence(compress(), immutableAssets, helloWorld, asciiDog, analytics, encodeDebugBarPaths, noCache, cookieVaryTestHandle, shotHandle),
  handleError,
  idleTimeout: 60,
  compressServerIslandProps: true,
  // optimize: { enabled: true, exclude: [] },
  warmup: { enabledInProd: true, enabledInDev: true },
  additionalWatchPaths: ['../docs'],
  logger: { level: 'log' },
  proxy: { origin }, // TODO: This is a bit of an awkward way to set the allowed csrf domain...
  // Named image sizes used by the /demos/image* pages (kept in sync with the
  // example shown in ./src/demoIndex.ts).
  image: {
    // The image-invalidation demo sources from our own loopback endpoint, which the
    // SSRF guard would otherwise reject as a private address. Safe here: every image
    // src on this site is hardcoded and server-minted (encrypted URLs), never taken
    // from user input, so there's no arbitrary-fetch vector to protect against.
    blockPrivateNetworks: false,
    sizes: {
      // Docs screenshots: authored at their natural size (<= 1400px) and shown in a
      // ~800px prose column, so this only re-encodes to webp — it never resizes.
      doc: { width: 1400, withoutEnlargement: true, format: 'webp', quality: 82 },
      hero: { width: 600, height: 400, fit: 'inside' },
      square: { width: 400, height: 400, fit: 'inside' },
      card: { width: 400, height: 267, fit: 'inside' },
      thumb: { width: 240, height: 240, fit: 'inside' },
      'fit-fill': { width: 240, height: 240, fit: 'fill' },
      'fit-inside': { width: 240, height: 240, fit: 'inside' },
      rotate90: { width: 200, height: 200, fit: 'inside', rotate: 90 },
      rotate180: { width: 200, height: 200, fit: 'inside', rotate: 180 },
      rotate270: { width: 200, height: 200, fit: 'inside', rotate: 270 },
      flip: { width: 200, height: 200, fit: 'inside', flip: true },
      flop: { width: 200, height: 200, fit: 'inside', flop: true },
      grayscale: { width: 200, height: 200, fit: 'inside', modulate: { saturation: 0 } },
      brighten: { width: 200, height: 200, fit: 'inside', modulate: { brightness: 1.5 } },
      saturate: { width: 200, height: 200, fit: 'inside', modulate: { saturation: 2 } },
      'fmt-jpeg': { width: 300, height: 300, fit: 'inside', format: 'jpeg', quality: 85 },
      'fmt-png': { width: 300, height: 300, fit: 'inside', format: 'png' },
      'fmt-webp': { width: 300, height: 300, fit: 'inside', format: 'webp', quality: 80 },
    },
  },
  markdown: markdownConfig,
  eventHooks: {
    'mochi:init': ({ options }) => {
      logger.info(`init: starting on port ${options.port}`);
    },
  },
  filters: {
    'consoleLogger:line': (line, ctx) => (ctx.path.startsWith('/health') ? null : silenceInternalRoutes(line, ctx)),
    // The MCP endpoint must answer at exactly /mcp; the site-wide trailingSlash: 'always'
    // policy would otherwise 308 it to /mcp/ and some MCP clients don't follow the redirect.
    'trailingSlash:redirect': (redirect, { url }) => (url.pathname === '/mcp' ? null : redirect),
  },
  features: {
    'demo-new-hero': { rollout: 0.5 },
    'demo-beta-badge': { rollout: 0.5 },
  },
  routes,
  queues,
});

logger.info('Server running at ' + origin);
