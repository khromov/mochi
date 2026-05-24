import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import Tailwind from './Tailwind.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/tailwind': Mochi.page(Tailwind),
};
