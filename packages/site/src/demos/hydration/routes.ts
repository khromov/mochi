import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import Hydration from './Hydration.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/hydration': Mochi.page(Hydration),
};
