import { mochiEvents, logger } from 'mochi-framework';

// A few source photos the page resizes on cold load, minting original + variant
// (+ placeholder) cache writes — each fires an `image:store` we log below.
export const remote = 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-3.jpg';

// Custom integration: mirror every image cache write/delete to the server
// console with a grep-friendly tag. This is exactly where an S3 mirror would
// read `path` and PUT/DELETE the object. `setHandler` (not `.on`) keeps dev
// re-imports from piling up duplicate subscribers.
mochiEvents.setHandler('demo:image-events:store', 'image:store', ({ kind, path, size, width, height }) => {
  const dims = width && height ? ` ${width}x${height}` : '';
  logger.info(`[demo:image-events] store  ${kind}${dims} (${size}B) → ${path}`);
});

mochiEvents.setHandler('demo:image-events:delete', 'image:delete', ({ kind, reason, path, size }) => {
  logger.info(`[demo:image-events] delete ${kind} (${reason}, freed ${size}B) → ${path}`);
});
