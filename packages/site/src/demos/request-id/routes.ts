import { Mochi, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/request-id': Mochi.page('./src/demos/request-id/RequestId.svelte', {
    serverProps: () => ({ requestId: getRequestContext().requestId }),
  }),
  '/demos/request-id/api': Mochi.api(() => Response.json({ requestId: getRequestContext().requestId })),
};
