import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/log-levels': Mochi.page('./src/demos/log-levels/LogLevels.svelte'),
  '/demos/log-levels/loud': Mochi.api(() => Response.json({ logged: 'warn' })),
  '/demos/log-levels/quiet': Mochi.api(() => Response.json({ logged: 'debug' })),
};
