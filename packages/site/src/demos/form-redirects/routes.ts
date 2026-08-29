import { Mochi, redirect, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import FormRedirects from './FormRedirects.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/form-redirects': Mochi.page(FormRedirects, {
    serverProps: () => {
      const { url } = getRequestContext();
      return { redirected: url.searchParams.has('redirected') };
    },
    actions: {
      doRedirect: () => redirect(303, '/demos/form-redirects?redirected=1'),
    },
  }),
};
