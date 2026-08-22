import { Mochi, logger } from 'mochi-framework';
import { routes, queues } from './routes';

await Mochi.serve({
  port: 3333,
  development: process.env.MODE === 'development',
  routes,
  queues,
});

logger.info('Server running at http://localhost:3333');
