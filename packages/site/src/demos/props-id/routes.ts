import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/props-id': Mochi.page('./src/demos/props-id/PropsId.svelte'),
};
