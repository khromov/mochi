import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/i18n-cookie': Mochi.page('./src/demos/i18n-cookie/I18nCookie.svelte'),
};
