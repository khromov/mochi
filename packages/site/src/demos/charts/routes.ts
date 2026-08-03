import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/charts': Mochi.page('./src/demos/charts/Charts.svelte'),
  '/demos/charts/traffic.png': Mochi.api(async ({ url }) => {
    const { renderTrafficChart } = await import('./serverChart');
    const width = Number(url.searchParams.get('width') ?? 640);
    const height = Number(url.searchParams.get('height') ?? 240);
    const format = url.searchParams.get('format') === 'jpeg' ? 'jpeg' : 'png';
    const image = await renderTrafficChart({ width, height, format });
    return new Response(image, {
      headers: { 'Content-Type': `image/${format}`, 'Cache-Control': 'public, max-age=3600' },
    });
  }),
};
