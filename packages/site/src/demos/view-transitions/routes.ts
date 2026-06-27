import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/view-transitions': Mochi.page('./src/demos/view-transitions/PageOne.svelte'),
  '/demos/view-transitions/two': Mochi.page('./src/demos/view-transitions/PageTwo.svelte'),
};
