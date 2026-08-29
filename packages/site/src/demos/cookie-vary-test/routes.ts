import { Mochi } from 'mochi-framework';
import type { Handle, MochiRouteValue } from 'mochi-framework';
import CookieVaryTest from './CookieVaryTest.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/cookie-vary-test': Mochi.page(CookieVaryTest),
};

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (event.url.pathname === '/cookie-vary-test' || event.url.pathname === '/cookie-vary-test/') {
    response.headers.set('Vary', 'Cookie');
  }
  return response;
};
