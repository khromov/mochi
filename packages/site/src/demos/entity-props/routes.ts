import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/entity-props': Mochi.page('./src/demos/entity-props/EntityDemo.svelte'),
};
