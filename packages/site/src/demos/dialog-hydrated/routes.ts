import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/dialog-hydrated': Mochi.page('./src/demos/dialog-hydrated/DialogHydrated.svelte'),
};
