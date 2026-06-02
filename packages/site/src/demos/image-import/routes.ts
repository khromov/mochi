import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/image-import': Mochi.page('./src/demos/image-import/ImageImport.svelte'),
};
