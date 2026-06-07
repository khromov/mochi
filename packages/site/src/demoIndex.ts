import { Mochi, logger } from 'mochi-framework';

await Mochi.serve({
  port: 3333,
  development: process.env.MODE === 'development',
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});

logger.info('Server running at http://localhost:3333');
