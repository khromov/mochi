import { Mochi, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import FormReturnData from './FormReturnData.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/form-return-data': Mochi.page(FormReturnData, {
    actions: {
      random: () => success({ value: Math.floor(Math.random() * 100) + 1 }),
    },
  }),
};
