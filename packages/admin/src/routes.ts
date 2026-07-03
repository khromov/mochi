import type { MochiRouteValue } from 'mochi-framework';
import { routes as dashboardRoutes } from './routes/dashboard';
import { routes as authRoutes } from './routes/auth';
import { routes as productRoutes } from './routes/products';

export const routes: Record<string, MochiRouteValue> = {
  ...dashboardRoutes,
  ...authRoutes,
  ...productRoutes,
};
