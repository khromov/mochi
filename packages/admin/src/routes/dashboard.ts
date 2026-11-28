import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { currentUser } from '../lib/auth.server';

export const routes: Record<string, MochiRouteValue> = {
  '/': Mochi.page('./src/Dashboard.svelte', {
    serverProps: () => ({ user: currentUser() }),
  }),
};
