// @ts-check
import { defineConfig } from 'wuchale';
import { adapter as svelte } from '@wuchale/svelte';

// Mochi drives Wuchale without Vite (see Mochi.serve({ i18n }) in src/index.ts).
// `loader: 'custom'` lets Mochi generate request-context-aware loaders.
export default defineConfig({
  locales: ['en', 'sv', 'uk'],
  localesDir: './src/i18n/locales',
  adapters: {
    main: svelte({
      loader: 'custom',
      files: ['src/i18n/**/*.svelte'],
    }),
  },
});
