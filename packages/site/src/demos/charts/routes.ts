import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

const MIN_SIZE = 64;
const MAX_SIZE = 2000;

// The canvas is allocated in one shot from these, so an unclamped `?width=40000` is a memory-exhaustion lever.
function clampSize(raw: string | null, fallback: number): number {
  // `?width=` yields '' and `Number('')` is 0, which would clamp to MIN_SIZE instead of the default.
  const n = raw?.trim() ? Number(raw) : fallback;
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.trunc(n)));
}

export const routes: Record<string, MochiRouteValue> = {
  '/demos/charts': Mochi.page('./src/demos/charts/Charts.svelte'),
  '/demos/charts/traffic.png': Mochi.api(
    async ({ url }) => {
      const { renderTrafficChart } = await import('./serverChart');
      const width = clampSize(url.searchParams.get('width'), 640);
      const height = clampSize(url.searchParams.get('height'), 240);
      const format = url.searchParams.get('format') === 'jpeg' ? 'jpeg' : 'png';
      const image = await renderTrafficChart({ width, height, format });
      return new Response(image, {
        headers: { 'Content-Type': `image/${format}`, 'Cache-Control': 'public, max-age=3600' },
      });
    },
    { rateLimit: { limit: 60, window: '1m' } },
  ),
};
