import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import Lazy from './Lazy.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/lazy': Mochi.page(Lazy),
};
