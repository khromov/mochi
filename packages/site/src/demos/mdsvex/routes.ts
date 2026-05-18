import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/mdsvex': Mochi.page('./src/demos/mdsvex/MdsvexDemo.svelte'),
};
