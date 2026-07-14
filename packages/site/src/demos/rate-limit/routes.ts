import { Mochi, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/rate-limit': Mochi.page('./src/demos/rate-limit/RateLimit.svelte', {
    rateLimit: { limit: 5, window: '1m' },
    serverProps: () => {
      const rateLimit = getRequestContext().rateLimit;
      return {
        used: rateLimit ? rateLimit.limit - rateLimit.remaining : 1,
        limit: rateLimit?.limit ?? 5,
        resetIn: rateLimit?.resetIn ?? 60,
      };
    },
  }),
};
