import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import Hello from './Hello.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/docs/your-first-mochi-app/hello': Mochi.page(Hello, {
    serverProps: () => ({
      siteName: 'Mochi',
      renderedAt: new Date().toISOString(),
    }),
  }),
};
