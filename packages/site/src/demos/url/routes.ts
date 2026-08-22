import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import Url from './Url.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/url': Mochi.page(Url),
};
