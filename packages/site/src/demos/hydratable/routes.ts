import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/hydratable': Mochi.page('./src/demos/hydratable/Hydratable.svelte'),
};
