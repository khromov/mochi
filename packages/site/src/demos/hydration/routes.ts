import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/hydration': Mochi.page('./src/demos/hydration/Hydration.svelte'),
};
