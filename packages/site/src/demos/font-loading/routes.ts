import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import FontLoading from './FontLoading.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/font-loading': Mochi.page(FontLoading),
};
