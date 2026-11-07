import { Mochi } from 'mochi-framework';
import type { MochiRouteValue, MochiCronConfig } from 'mochi-framework';
import { activityLog, addClient, removeClient } from './cron.server';

// Mounted in the site's Mochi.serve({ cron }) call — see src/routes.ts.
export const cron: MochiCronConfig[] = [activityLog];

export const routes: Record<string, MochiRouteValue> = {
  '/demos/cron': Mochi.page('./src/demos/cron/Cron.svelte'),
  '/ws/cron-log': Mochi.ws({
    open(ws) {
      addClient(ws);
    },
    message() {},
    close(ws) {
      removeClient(ws);
    },
  }),
};
