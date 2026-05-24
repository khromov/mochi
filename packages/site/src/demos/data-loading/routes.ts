import { Mochi, fail, redirect } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import DataLoading from './DataLoading.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/data-loading': (req: Request) => Response.redirect(new URL('/demos/data-loading/pikachu', req.url), 302),
  '/demos/data-loading/:id': Mochi.page(DataLoading, {
    actions: {
      default: async ({ formData }) => {
        const pokemon = String(formData.get('pokemon') ?? '')
          .trim()
          .toLowerCase();
        if (!pokemon) {
          return fail(400, { error: 'Pokemon required' });
        }
        return redirect(303, `/demos/data-loading/${encodeURIComponent(pokemon)}`);
      },
    },
  }),
};
