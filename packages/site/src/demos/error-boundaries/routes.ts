import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import ErrorBoundaries from './ErrorBoundaries.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/error-boundaries': Mochi.page(ErrorBoundaries),
};
