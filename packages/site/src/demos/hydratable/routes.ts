import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import Hydratable from './Hydratable.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/hydratable': Mochi.page(Hydratable),
};
