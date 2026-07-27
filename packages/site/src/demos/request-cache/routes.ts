import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/request-cache': Mochi.page('./src/demos/request-cache/RequestCache.svelte'),
};
