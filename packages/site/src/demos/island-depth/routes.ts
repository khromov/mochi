import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/island-depth': Mochi.page('./src/demos/island-depth/IslandDepth.svelte'),
};
