import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/dialog-progressive': Mochi.page('./src/demos/dialog-progressive/DialogProgressive.svelte'),
};
