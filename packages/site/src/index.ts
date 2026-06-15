import path from 'node:path';
import { compile as mdsvexCompile } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import rehypeExternalLinks from './lib/rehypeExternalLinks';
import { Mochi, mochiEvents, sequence, logger, noCache, compress, silenceInternalRoutes } from 'mochi-framework';
import type { Handle, HandleError, MarkdownConfig } from 'mochi-framework';
import { generateDocsBarrel } from './lib/generateDocsBarrel';
import { clearDocsCaches, DOCS_DIR } from './lib/docs';
import { highlightCode } from './lib/highlight.server';
import { handle as cookieVaryTestHandle } from './demos/cookie-vary-test/routes';
import { routes } from './routes';

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

// We run this site in dev mode in production to show off the debug bar. The debug bar inlines
// build-time file paths (e.g. "../mochi/src/cookies.client.ts") as raw JSON in executable
// <script>s; crawlers mine those slash-shaped strings as relative URLs and resolve them against
// the page, producing phantom Search Console URLs like /mochi/src/cookies.client.ts. Base64 the
// payload so it's opaque to static link extraction — the client decodes back to the same value,
// leaving the debug bar fully functional. jsonForHtml escapes `<`, so the JSON never contains a
// literal `</script>`, making the non-greedy match safe.
const DEBUG_GLOBALS = ['__mochi_debug', '__mochi_page_entry'];
const encodeDebugBarPaths: Handle = async ({ event, resolve }) => {
  if (!DEVELOPMENT) {
    return resolve(event);
  }
  return resolve(event, {
    transformPage({ html }) {
      let out = html;
      for (const name of DEBUG_GLOBALS) {
        out = out.replace(
          new RegExp(`<script>window\\.${name}=(.+?)</script>`),
          (_m, json) =>
            `<script>window.${name}=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(${JSON.stringify(
              Buffer.from(json, 'utf8').toString('base64'),
            )}),(c)=>c.charCodeAt(0))))</script>`,
        );
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
  handle: sequence(compress(), immutableAssets, helloWorld, asciiDog, analytics, encodeDebugBarPaths, noCache, cookieVaryTestHandle),
  handleError,
  idleTimeout: 60,
  compressServerIslandProps: true,
  optimize: { enabled: true, exclude: [] },
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
