import { Mochi, logger } from 'mochi-framework';
import { routes } from './routes';

await Mochi.serve({
  port: 3333,
  development: process.env.NODE_ENV === 'development',
  protection: {
    enabled: true,
    // Without protect(), EVERY route requires browser verification. Here only
    // this demo's page and its API are gated.
    protect: ({ path }) => path === '/demos/protection' || path === '/demos/protection/' || path.startsWith('/demos/protection/api'),
    // Proof-of-work difficulty in leading zero bits — each extra bit doubles the work.
    bits: 20,
    // How long a passed verification lasts before the interstitial shows again.
    maxAgeMs: 4 * 60 * 60 * 1000,
  },
  routes,
});

logger.info('Server running at http://localhost:3333');
