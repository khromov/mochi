import { Mochi, silenceInternalRoutes } from 'mochi-framework';
import type { Handle } from 'mochi-framework';
import { routes } from './routes';

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
  handle: immutableAssets,
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
  },
  routes,
});

console.log('Server running at http://localhost:' + PORT);
