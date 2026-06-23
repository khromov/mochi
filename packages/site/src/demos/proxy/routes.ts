import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { upstreamOrigin } from './upstream.ts';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/proxy': Mochi.page('./src/demos/proxy/Proxy.svelte'),
  // Everything under /demos/proxy/up/ is reverse-proxied to the in-process
  // upstream, with the /demos/proxy/up prefix stripped before forwarding.
  '/demos/proxy/up/*': Mochi.proxy({
    target: () => upstreamOrigin,
  }),
};
