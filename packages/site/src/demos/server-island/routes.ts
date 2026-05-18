import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/server-island': Mochi.page('./src/demos/server-island/ServerIsland.svelte'),
};
