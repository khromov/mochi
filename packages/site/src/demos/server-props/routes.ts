import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/server-props': Mochi.page('./src/demos/server-props/ServerProps.svelte', {
    serverProps: (req) => ({
      renderedAt: new Date().toISOString(),
      userAgent: req.headers.get('user-agent') ?? 'unknown',
      random: Math.floor(Math.random() * 10_000),
    }),
  }),
};
