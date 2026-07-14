import { Mochi, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/rate-limit': Mochi.page('./src/demos/rate-limit/RateLimit.svelte', {
    rateLimit: { limit: 5, window: '1m' },
    serverProps: () => {
      const rl = getRequestContext().rateLimit;
      return {
        used: rl ? rl.limit - rl.remaining : 1,
        limit: rl?.limit ?? 5,
        resetIn: rl?.resetIn ?? 60,
      };
    },
  }),
};
