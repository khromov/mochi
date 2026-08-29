import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import HelloWorld from './HelloWorld.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/hello-world': Mochi.page(HelloWorld),
};
