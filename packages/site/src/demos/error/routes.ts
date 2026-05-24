import { Mochi, error } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import ErrorDemo from './ErrorDemo.svelte';
import Error500 from './Error500.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/error': Mochi.page(ErrorDemo),
  '/demos/error/500': Mochi.page(Error500),
  '/demos/error/404': Mochi.page(Error500, {
    serverProps: () => {
      error(404, 'This item does not exist.');
    },
  }),
  // Throws during SSR, but the site-wide handleError returns a redirect Response
  // for this pathname, so the error page is never rendered.
  '/demos/error/redirect': Mochi.page(Error500),
};
