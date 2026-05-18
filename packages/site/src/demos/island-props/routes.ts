import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/island-props': Mochi.page('./src/demos/island-props/ServerRenderedParent.svelte'),
};
