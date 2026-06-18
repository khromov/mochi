import { Mochi, sequence, silenceInternalRoutes } from 'mochi-framework';
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

const ANALYTICS_SCRIPT = `<script defer src="https://u.khromov.se/u.js" data-website-id="8dceb8f5-6533-4c03-9cd6-1ce74accd63a"></script>`;
const analytics: Handle = async ({ event, resolve }) => {
  return resolve(event, {
    transformPage({ html }) {
      return html.replace('{{mochi.analytics}}', IS_DOCKER ? ANALYTICS_SCRIPT : '');
    },
  });
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
  handle: sequence(immutableAssets, analytics),
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
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
    ...adminRoutes,
    ...hnRoutes,
    ...i18nRoutes,
    ...todoRoutes,
  },
});

console.log('Server running at http://localhost:' + PORT);
