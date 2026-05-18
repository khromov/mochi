import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/form-errors': Mochi.page('./src/demos/form-errors/FormErrors.svelte', {
    actions: {
      throwError: () => {
        throw new Error('Something went wrong on the server');
      },
    },
  }),
};
