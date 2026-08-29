import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import PropDedup from './PropDedup.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/prop-dedup': Mochi.page(PropDedup),
};
