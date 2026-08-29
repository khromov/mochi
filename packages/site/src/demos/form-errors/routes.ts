import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import FormErrors from './FormErrors.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/form-errors': Mochi.page(FormErrors, {
    actions: {
      throwError: () => {
        throw new Error('Something went wrong on the server');
      },
    },
  }),
};
