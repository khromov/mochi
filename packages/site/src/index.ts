import path from 'node:path';
import { Mochi, mochiEvents, sequence, logger, noCache, compress, silenceInternalRoutes } from 'mochi-framework';
import type { Handle, HandleError } from 'mochi-framework';
import { generateDocsBarrel } from './lib/generateDocsBarrel';
import { clearDocsCaches, DOCS_DIR } from './lib/docs';
import { routes } from './routes';
import { handle as cookieVaryTestHandle } from './demos/cookie-vary-test/routes';

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
  additionalWatchPaths: ['../docs'],
  logger: { level: 'log' },
  proxy: { origin }, // TODO: This is a bit of an awkward way to set the allowed csrf domain...
  markdownConfigPath: './mdsvex.config.ts',
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
