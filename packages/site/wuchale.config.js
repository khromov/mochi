// @ts-check
import { defineConfig } from 'wuchale';
import { adapter as svelte } from '@wuchale/svelte';

// Scoped to the i18n-cookie demo so the rest of the site is untouched.
// Mochi drives Wuchale without Vite — see Mochi.serve({ i18n }) in src/index.ts.
export default defineConfig({
  locales: ['en', 'sv', 'uk'],
  localesDir: './src/demos/i18n-cookie/locales',
  adapters: {
    main: svelte({
      loader: 'custom',
      files: ['src/demos/i18n-cookie/**/*.svelte'],
    }),
  },
});
