import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/tailwind': Mochi.page('./src/demos/tailwind/Tailwind.svelte'),
};
