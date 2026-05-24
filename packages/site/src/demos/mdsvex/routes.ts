import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import MdsvexDemo from './MdsvexDemo.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/mdsvex': Mochi.page(MdsvexDemo),
};
