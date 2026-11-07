import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { loadVarlockConfig } from './env';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/varlock': Mochi.page('./src/demos/varlock/Varlock.svelte', {
    serverProps: async () => ({ config: await loadVarlockConfig() }),
  }),
};
