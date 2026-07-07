import { Mochi, invalidateImage, redirect, getRequestContext, mochiEvents } from 'mochi-framework';
import type { MochiRouteValue, MochiImageDeleteEvent } from 'mochi-framework';

// Our own source endpoint serves a *random* one of the bundled photos on each
// request, so an invalidated cache is visibly different once it's re-fetched.
const IMAGE_COUNT = 14;
const pickImage = () => `./images/mochi-${1 + Math.floor(Math.random() * IMAGE_COUNT)}.jpg`;

// The image source is our own endpoint, absolute so the image pipeline can fetch
// it. `.jpg` keeps it clear of the site's trailingSlash normalization.
const sourceUrl = () => `${getRequestContext().url.origin}/demos/image-invalidation/source.jpg`;

let generation = 0;

// TEMPORARY (delete-cascade inspection): the image:delete events captured during
// the last hard invalidation, surfaced to the page + browser console.
let lastDeleted: { kind: string; id: string; reason: string }[] = [];

export const routes: Record<string, MochiRouteValue> = {
  // Random-image source: a fresh random bundled photo on every request.
  '/demos/image-invalidation/source.jpg': Mochi.file(pickImage),

  '/demos/image-invalidation': Mochi.page('./src/demos/image-invalidation/ImageInvalidationDemo.svelte', {
    serverProps: () => ({ src: sourceUrl(), generation, deleted: lastDeleted }),
    actions: {
      // Hard delete: drop the shared original and cascade to its variants. We
      // capture the image:delete events it emits so the demo can show exactly
      // which cached sizes were removed. Post/Redirect/Get so a refresh doesn't
      // re-submit; the bumped `generation` rides through serverProps on the GET.
      default: async () => {
        const src = sourceUrl();
        const captured: { kind: string; id: string; reason: string }[] = [];
        const onDelete = (e: MochiImageDeleteEvent) => {
          if (e.src === src) {
            captured.push({ kind: e.kind, id: e.id, reason: e.reason });
          }
        };
        mochiEvents.on('image:delete', onDelete);
        try {
          await invalidateImage(src, { hard: true });
        } finally {
          mochiEvents.off('image:delete', onDelete);
        }
        lastDeleted = captured;

        // Mirror to the dev-server console (matches the cache-events demo).
        console.log(`[demo:image-invalidation] hard delete cascade removed ${captured.length} cached entries:`);
        for (const d of captured) {
          console.log(`  • ${d.kind} ${d.id} (${d.reason})`);
        }

        generation++;
        return redirect(303, '/demos/image-invalidation/');
      },
    },
  }),
};
