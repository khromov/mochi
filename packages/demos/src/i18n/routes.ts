import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// Optional locale prefix. Static routes (`/i18n`, `/i18n/about`) are English;
// the `:lang` variants serve Swedish/Ukrainian. Static routes win over the
// param route in Bun's matcher, so `/i18n/about` is never read as lang=about.
export const routes: Record<string, MochiRouteValue> = {
  '/i18n': Mochi.page('./src/i18n/Home.svelte'),
  '/i18n/about': Mochi.page('./src/i18n/About.svelte'),
  '/i18n/:lang': Mochi.page('./src/i18n/Home.svelte'),
  '/i18n/:lang/about': Mochi.page('./src/i18n/About.svelte'),
};
