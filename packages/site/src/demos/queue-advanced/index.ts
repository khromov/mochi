import { Mochi, logger } from 'mochi-framework';
import type { MochiQueueStorage } from 'mochi-framework';
import { routes, queues } from './routes';

// One store serves every queue in the process, picked once at boot:
// QUEUE_STORAGE=memory (default) | sqlite | postgres — postgres reads DATABASE_URL.
const queueStorage: MochiQueueStorage =
  process.env.QUEUE_STORAGE === 'sqlite' ? { sqlite: '.mochi/queue-demo.sqlite' } : process.env.QUEUE_STORAGE === 'postgres' ? { postgres: process.env.DATABASE_URL! } : 'memory';

await Mochi.serve({
  port: 3333,
  development: process.env.MODE === 'development',
  routes,
  queues,
  queueStorage,
});

logger.info(`Server running at http://localhost:3333 — queue storage: ${typeof queueStorage === 'string' ? queueStorage : Object.keys(queueStorage)[0]}`);
