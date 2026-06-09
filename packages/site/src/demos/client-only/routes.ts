import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/client-only': Mochi.page('./src/demos/client-only/ClientOnly.svelte'),
};
