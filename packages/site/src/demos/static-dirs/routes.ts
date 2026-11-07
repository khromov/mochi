import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/static-dirs': Mochi.page('./src/demos/static-dirs/StaticDirsDemo.svelte'),
};
