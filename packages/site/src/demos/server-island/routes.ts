import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import ServerIsland from './ServerIsland.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/server-island': Mochi.page(ServerIsland),
};
