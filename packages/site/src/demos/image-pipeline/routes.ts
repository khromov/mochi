import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/image-pipeline': Mochi.page('./src/demos/image-pipeline/ImagePipelineDemo.svelte'),
};
