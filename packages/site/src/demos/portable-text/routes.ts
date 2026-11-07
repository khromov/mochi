import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/portable-text': Mochi.page('./src/demos/portable-text/PortableTextDemo.svelte'),
};
