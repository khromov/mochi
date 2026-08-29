import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import ImageDemo from './ImageDemo.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/image': Mochi.page(ImageDemo),
};
