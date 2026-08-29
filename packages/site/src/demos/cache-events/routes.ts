import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import CacheEvents from './CacheEvents.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/cache-events': Mochi.page(CacheEvents),
};
