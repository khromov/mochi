import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import NestedComponents from './NestedComponents.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/nested-components': Mochi.page(NestedComponents),
};
