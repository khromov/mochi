import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/custom-transitions': Mochi.page('./src/demos/custom-transitions/PageOne.svelte'),
  '/demos/custom-transitions/two': Mochi.page('./src/demos/custom-transitions/PageTwo.svelte'),
};
