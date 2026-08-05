import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/mode-watcher': Mochi.page('./src/demos/mode-watcher/ModeWatcher.svelte'),
};
