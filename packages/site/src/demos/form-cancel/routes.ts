import { Mochi, fail, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import FormCancel from './FormCancel.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/form-cancel': Mochi.page(FormCancel, {
    actions: {
      lookup: async ({ formData }) => {
        const query = String(formData.get('query') ?? '').trim();
        if (!query) {
          return fail(400, { error: 'Query is required' });
        }
        await Bun.sleep(3000);
        return success({ result: `Found: ${query} — status active` });
      },
    },
  }),
};
