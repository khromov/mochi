import { Mochi, logger } from 'mochi-framework';
import { routes, cron } from './routes';

await Mochi.serve({
  port: 3333,
  development: process.env.NODE_ENV === 'development',
  routes,
  cron,
});

logger.info('Server running at http://localhost:3333');
