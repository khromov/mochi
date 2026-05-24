import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import LazyServerIsland from './LazyServerIsland.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/lazy-server-island': Mochi.page(LazyServerIsland),
};
