import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/hello-world': Mochi.page('./src/demos/hello-world/HelloWorld.svelte'),
};
