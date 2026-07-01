import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/nested-islands': Mochi.page('./src/demos/nested-islands/NestedIslands.svelte'),
};
