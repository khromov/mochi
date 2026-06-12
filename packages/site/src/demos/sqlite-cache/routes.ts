import { Mochi, redirect } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { reportCache } from './cache';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/sqlite-cache': Mochi.page('./src/demos/sqlite-cache/SqliteCache.svelte', {
    actions: {
      // Post/Redirect/Get: send the browser back to the clean URL after clearing
      // so a refresh doesn't re-POST and the address bar drops the `?/clear` query.
      clear: async () => {
        await reportCache.clearItems();
        return redirect(303, '/demos/sqlite-cache/');
      },
    },
  }),
};
