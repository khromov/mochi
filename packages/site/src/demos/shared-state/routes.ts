import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import SharedState from './SharedState.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/shared-state': Mochi.page(SharedState),
};
