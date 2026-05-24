import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import ServerProps from './ServerProps.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/server-props': Mochi.page(ServerProps, {
    serverProps: (req) => ({
      renderedAt: new Date().toISOString(),
      userAgent: req.headers.get('user-agent') ?? 'unknown',
      random: Math.floor(Math.random() * 10_000),
    }),
  }),
};
