import { Mochi, logger } from 'mochi-framework';
import { routes } from './routes';

await Mochi.serve({
  port: 3333,
  development: process.env.MODE === 'development',
  routes,
});

logger.info('Server running at http://localhost:3333');
