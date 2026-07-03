<script lang="ts">
  import type { Point } from '../lib/analytics';

  // Non-hydrated chart: a hand-rolled SVG sparkline. The path is computed on the
  // server from the data and rendered as plain SVG, so it ships ZERO JavaScript
  // and needs no hydration or client measurement. (Charting libraries like
  // FlareCharts draw their marks on the client after measuring the container, so
  // they can't render geometry during SSR — for a static chart, server-rendered
  // SVG is both simpler and lighter.)
  let { data, height = 120 }: { data: Point[]; height?: number } = $props();

  const W = 720;
  const PAD = 6;
  const ys = data.map((d) => d.v);
  const minY = Math.min(...ys);
  const spanY = Math.max(...ys) - minY || 1;
  const n = data.length;

  const px = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const py = (v: number) => PAD + (1 - (v - minY) / spanY) * (height - PAD * 2);

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(2)},${py(d.v).toFixed(2)}`).join(' ');
  const area = `${line} L${W},${height} L0,${height} Z`;
</script>

<div class="w-full text-matcha-500 dark:text-matcha-400">
  <svg viewBox="0 0 {W} {height}" preserveAspectRatio="none" width="100%" {height} role="img" aria-label="Revenue over the last 30 days" class="block">
    <defs>
      <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.22" />
        <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path d={area} fill="url(#revenue-fill)" />
    <path d={line} fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>
</div>
