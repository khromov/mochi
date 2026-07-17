import { Mochi, sequence, silenceInternalRoutes } from 'mochi-framework';
import type { Handle } from 'mochi-framework';
import { analytics } from './analytics';
import { routes as adminRoutes } from './admin/routes';
import { routes as hnRoutes } from './hn/routes';
import { routes as todoRoutes } from './todo/routes';

const IS_DOCKER = process.env.MOCHI_DOCKER === 'true';
const immutableAssets: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (IS_DOCKER && event.kind === 'asset') {
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  return response;
};

const PORT = Number(process.env.PORT) || 3334;

await Mochi.serve({
  port: PORT,
  development: process.env.MODE === 'development',
  liveReload: process.env.MOCHI_LIVE_RELOAD === 'false' ? false : undefined,
  htmlShell: './src/shell.html',
  trailingSlash: 'always',
  idleTimeout: 60,
  compressServerIslandProps: true,
  warmup: true,
  proxy: { origin: process.env.MOCHI_ORIGIN || `http://localhost:${PORT}` },
  handle: sequence(immutableAssets, analytics),
  filters: {
    'consoleLogger:line': (line, ctx) => (ctx.path.startsWith('/health') ? null : silenceInternalRoutes(line, ctx)),
  },
  routes: {
    '/': Mochi.page('./src/Landing.svelte'),
    '/health': Mochi.api(({ method }) => Response.json({ status: 'ok', method })),
    ...adminRoutes,
    ...hnRoutes,
    ...todoRoutes,
  },
});

console.log('Server running at http://localhost:' + PORT);
