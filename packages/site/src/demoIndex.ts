import { Mochi, logger } from 'mochi-framework';
import HelloWorld from './HelloWorld.svelte';

await Mochi.serve({
  port: 3333,
  development: process.env.MODE === 'development',
  routes: {
    '/': Mochi.page(HelloWorld),
  },
});

logger.info('Server running at http://localhost:3333');
