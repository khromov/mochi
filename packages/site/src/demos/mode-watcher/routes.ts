import { Mochi, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue, Handle } from 'mochi-framework';
import { THEME_COOKIE } from './constants';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/mode-watcher': Mochi.page('./src/demos/mode-watcher/ModeWatcher.svelte', {
    serverProps: () => ({ initialMode: getRequestContext().cookies.get(THEME_COOKIE) ?? null }),
  }),
};

// SSR the resolved theme: read the cookie the island mirrors the mode into, and set the `dark`
// class on <html> before it's sent so the first paint already matches — no flash on reload.
export const handle: Handle = async ({ event, resolve }) => {
  // Non-page requests (assets, unmatched paths) run outside a request context, where getRequestContext() throws.
  if (event.kind !== 'page' || !event.url.pathname.startsWith('/demos/mode-watcher')) {
    return resolve(event);
  }
  if (getRequestContext().cookies.get(THEME_COOKIE) !== 'dark') {
    return resolve(event);
  }
  return resolve(event, {
    transformPage: ({ html }) => html.replace('<html lang="en">', '<html lang="en" class="dark">'),
  });
};
