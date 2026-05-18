import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/error-boundaries': Mochi.page('./src/demos/error-boundaries/ErrorBoundaries.svelte'),
};
