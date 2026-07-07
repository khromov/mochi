import { Mochi, invalidateImage, redirect, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// Our own source endpoint serves a *random* one of the bundled photos on each
// request, so an invalidated cache is visibly different once it's re-fetched.
const IMAGE_COUNT = 14;
const pickImage = () => `./images/mochi-${1 + Math.floor(Math.random() * IMAGE_COUNT)}.jpg`;

// The image source is our own endpoint, absolute so the image pipeline can fetch
// it. `.jpg` keeps it clear of the site's trailingSlash normalization.
const sourceUrl = () => `${getRequestContext().url.origin}/demos/image-invalidation/source.jpg`;

let generation = 0;

export const routes: Record<string, MochiRouteValue> = {
  // Random-image source: a fresh random bundled photo on every request.
  '/demos/image-invalidation/source.jpg': Mochi.file(pickImage),

  '/demos/image-invalidation': Mochi.page('./src/demos/image-invalidation/ImageInvalidationDemo.svelte', {
    serverProps: () => ({ src: sourceUrl(), generation }),
    actions: {
      // Post/Redirect/Get: invalidate, then redirect back so a refresh doesn't
      // re-submit. The bumped `generation` rides through serverProps on the GET.
      default: async () => {
        await invalidateImage(sourceUrl(), { hard: true });
        generation++;
        return redirect(303, '/demos/image-invalidation/');
      },
    },
  }),
};
