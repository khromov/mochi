import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/font-loading': Mochi.page('./src/demos/font-loading/FontLoading.svelte'),
};
