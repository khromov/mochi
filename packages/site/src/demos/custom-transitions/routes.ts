import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// Both routes render one component; it reads the URL to tell page 1 from 2.
// A single page file keeps the compiled basename unique across the build.
export const routes: Record<string, MochiRouteValue> = {
  '/demos/custom-transitions': Mochi.page('./src/demos/custom-transitions/CustomTransitions.svelte'),
  '/demos/custom-transitions/two': Mochi.page('./src/demos/custom-transitions/CustomTransitions.svelte'),
};
