import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/image-events': Mochi.page('./src/demos/image-events/ImageEvents.svelte'),
};
