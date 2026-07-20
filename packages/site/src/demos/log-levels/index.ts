import { Mochi, logger } from 'mochi-framework';
import { routes } from './routes';
import { logLevelsFilter } from './filter';

await Mochi.serve({
  port: 3333,
  development: process.env.MODE === 'development',
  filters: {
    'consoleLogger:level': logLevelsFilter,
  },
  routes,
});

logger.info('Server running at http://localhost:3333');
