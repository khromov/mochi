import type { Handle } from '../runtime/hooks';

/**
 * Default `Cache-Control: no-cache` on `page` and `api` responses. Routes
 * that already set their own `Cache-Control` are left untouched.
 */
export const noCache: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  if (event.kind !== 'page' && event.kind !== 'api') {
    return response;
  }

  if (response.headers.has('cache-control')) {
    return response;
  }

  response.headers.set('Cache-Control', 'no-cache');
  return response;
};
