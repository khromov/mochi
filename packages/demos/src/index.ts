import { Mochi, silenceInternalRoutes } from 'mochi-framework';
import type { Handle } from 'mochi-framework';
import { routes as adminRoutes } from './admin/routes';
import { routes as hnRoutes } from './hn/routes';
import { routes as i18nRoutes } from './i18n/routes';
import { routes as todoRoutes } from './todo/routes';

const I18N_LOCALES = ['en', 'sv', 'uk'];

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
  handle: immutableAssets,
  filters: {
    'consoleLogger:line': (line, ctx) => (ctx.path.startsWith('/health') ? null : silenceInternalRoutes(line, ctx)),
  },
  i18n: {
    locales: I18N_LOCALES,
    sourceLocale: 'en',
    // Locale lives in the path: /i18n/sv, /i18n/uk; everything else is English.
    resolveLocale: ({ url }) => {
      const seg = url.pathname.split('/')[2] ?? '';
      return I18N_LOCALES.includes(seg) ? seg : 'en';
    },
  },
  routes: {
    '/': Mochi.page('./src/Landing.svelte'),
    '/health': Mochi.api(({ method }) => Response.json({ status: 'ok', method })),
    ...adminRoutes,
    ...hnRoutes,
    ...i18nRoutes,
    ...todoRoutes,
  },
});

console.log('Server running at http://localhost:' + PORT);
