import { Mochi, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { reportCache } from './cache';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/sqlite-cache': Mochi.page('./src/demos/sqlite-cache/SqliteCache.svelte', {
    actions: {
      clear: async () => {
        await reportCache.clearItems();
        return success();
      },
    },
  }),
};
