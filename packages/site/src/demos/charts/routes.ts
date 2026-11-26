import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import type { ChartFormat } from './serverChart';

// The paint is synchronous and the data static, so render each format once at the page's size rather than per request at caller-chosen dimensions.
const rendered = new Map<ChartFormat, Promise<Uint8Array<ArrayBuffer>>>();

function renderOnce(format: ChartFormat): Promise<Uint8Array<ArrayBuffer>> {
  let image = rendered.get(format);
  if (!image) {
    image = import('./serverChart').then(({ renderTrafficChart }) => renderTrafficChart({ width: 640, height: 240, format }));
    image.catch(() => rendered.delete(format));
    rendered.set(format, image);
  }
  return image;
}

export const routes: Record<string, MochiRouteValue> = {
  '/demos/charts': Mochi.page('./src/demos/charts/Charts.svelte'),
  '/demos/charts/traffic.png': Mochi.api(
    async ({ url }) => {
      const format = url.searchParams.get('format') === 'jpeg' ? 'jpeg' : 'png';
      return new Response(await renderOnce(format), {
        headers: { 'Content-Type': `image/${format}`, 'Cache-Control': 'public, max-age=3600' },
      });
    },
    { rateLimit: { limit: 60, window: '1m' } },
  ),
};
