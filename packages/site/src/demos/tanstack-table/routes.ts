import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/tanstack-table': Mochi.page('./src/demos/tanstack-table/TanStackTable.svelte'),
};
