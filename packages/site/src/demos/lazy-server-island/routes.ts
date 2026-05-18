import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/lazy-server-island': Mochi.page('./src/demos/lazy-server-island/LazyServerIsland.svelte'),
};
