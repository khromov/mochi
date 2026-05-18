import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/cache-events': Mochi.page('./src/demos/cache-events/CacheEvents.svelte'),
};
