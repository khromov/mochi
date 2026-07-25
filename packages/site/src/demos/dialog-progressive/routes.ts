import { Mochi, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/dialog-progressive': Mochi.page('./src/demos/dialog-progressive/DialogProgressive.svelte', {
    actions: {
      accept: ({ formData }) => success({ value: 'ok', from: String(formData.get('from') ?? '') }),
    },
  }),
};
