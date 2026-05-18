import { Mochi, error } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/error': Mochi.page('./src/demos/error/ErrorDemo.svelte'),
  '/demos/error/500': Mochi.page('./src/demos/error/Error500.svelte'),
  '/demos/error/404': Mochi.page('./src/demos/error/Error500.svelte', {
    serverProps: () => {
      error(404, 'This item does not exist.');
    },
  }),
  // Throws during SSR, but the site-wide handleError returns a redirect Response
  // for this pathname, so the error page is never rendered.
  '/demos/error/redirect': Mochi.page('./src/demos/error/Error500.svelte'),
};
