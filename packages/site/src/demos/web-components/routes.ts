import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/web-components': Mochi.page('./src/demos/web-components/WebComponents.svelte'),
};
