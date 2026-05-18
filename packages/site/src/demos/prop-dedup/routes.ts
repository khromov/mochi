import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/prop-dedup': Mochi.page('./src/demos/prop-dedup/PropDedup.svelte'),
};
