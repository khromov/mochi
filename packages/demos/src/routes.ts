import type { MochiRouteValue } from 'mochi-framework';
import { routes as adminRoutes } from './admin/routes';
import { routes as hnRoutes } from './hn/routes';
import { routes as todoRoutes } from './todo/routes';

export const routes: Record<string, MochiRouteValue> = {
  '/': () => Response.redirect('https://mochi.fast', 302),
  ...hnRoutes,
  ...adminRoutes,
  ...todoRoutes,
};
