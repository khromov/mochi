import { Mochi, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/form-return-data': Mochi.page('./src/demos/form-return-data/FormReturnData.svelte', {
    actions: {
      random: () => success({ value: Math.floor(Math.random() * 100) + 1 }),
    },
  }),
};
