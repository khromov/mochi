import { Mochi, logger } from 'mochi-framework';
import { routes } from './routes';

await Mochi.serve({
  port: 3333,
  development: process.env.MODE === 'development',
  // Named image sizes — referenced by name from <Image size="…">,
  // getImageUrl(src, 'name') and getImage(src, 'name'). The URL only carries the
  // src + size name; the endpoint runs the transform lazily on request.
  image: {
    sizes: {
      hero: { width: 600, height: 400, fit: 'inside' },
      square: { width: 400, height: 400, fit: 'inside' },
      card: { width: 400, height: 267, fit: 'inside' },
      thumb: { width: 240, height: 240, fit: 'inside' },
      'fit-fill': { width: 240, height: 240, fit: 'fill' },
      'fit-inside': { width: 240, height: 240, fit: 'inside' },
      rotate90: { width: 200, height: 200, fit: 'inside', rotate: 90 },
      rotate180: { width: 200, height: 200, fit: 'inside', rotate: 180 },
      rotate270: { width: 200, height: 200, fit: 'inside', rotate: 270 },
      flip: { width: 200, height: 200, fit: 'inside', flip: true },
      flop: { width: 200, height: 200, fit: 'inside', flop: true },
      grayscale: { width: 200, height: 200, fit: 'inside', modulate: { saturation: 0 } },
      brighten: { width: 200, height: 200, fit: 'inside', modulate: { brightness: 1.5 } },
      saturate: { width: 200, height: 200, fit: 'inside', modulate: { saturation: 2 } },
      'fmt-jpeg': { width: 300, height: 300, fit: 'inside', format: 'jpeg', quality: 85 },
      'fmt-png': { width: 300, height: 300, fit: 'inside', format: 'png' },
      'fmt-webp': { width: 300, height: 300, fit: 'inside', format: 'webp', quality: 80 },
    },
  },
  routes,
});

logger.info('Server running at http://localhost:3333');
