import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/is-hydratable': Mochi.page('./src/demos/is-hydratable/IsHydratable.svelte'),
};
