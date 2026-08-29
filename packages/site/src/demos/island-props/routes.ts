import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import ServerRenderedParent from './ServerRenderedParent.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/island-props': Mochi.page(ServerRenderedParent),
};
