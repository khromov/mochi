import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/defer-invalidation': Mochi.page('./src/demos/defer-invalidation/DeferInvalidation.svelte'),
};
