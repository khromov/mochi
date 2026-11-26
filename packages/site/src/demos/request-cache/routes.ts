import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  // Every render re-parses the whole book synchronously, so an unthrottled client could starve the rest of the site.
  '/demos/request-cache': Mochi.page('./src/demos/request-cache/RequestCache.svelte', { rateLimit: { limit: 60, window: '1m' } }),
};
