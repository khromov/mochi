import { Mochi } from 'mochi-framework';
import type { Handle, MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/cookie-vary-test': Mochi.page('./src/demos/cookie-vary-test/CookieVaryTest.svelte'),
};

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (event.url.pathname === '/cookie-vary-test' || event.url.pathname === '/cookie-vary-test/') {
    response.headers.set('Vary', 'Cookie');
  }
  return response;
};
