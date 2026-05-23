import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/docs/your-first-mochi-app/hello': Mochi.page('./src/demos/your-first-mochi-app/Hello.svelte', {
    serverProps: () => ({
      siteName: 'Mochi',
      renderedAt: new Date().toISOString(),
    }),
  }),
};
