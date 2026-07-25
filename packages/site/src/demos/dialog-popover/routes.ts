import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/dialog-popover': Mochi.page('./src/demos/dialog-popover/DialogPopover.svelte'),
};
