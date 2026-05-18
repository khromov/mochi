import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/nested-components': Mochi.page('./src/demos/nested-components/NestedComponents.svelte'),
};
