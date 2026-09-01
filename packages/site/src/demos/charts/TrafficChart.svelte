<script lang="ts">
  import { AreaChart } from 'layerchart/svg';
  import ChartFrame from './ChartFrame.svelte';
  import { traffic, seriesColors } from './data.ts';
  import type { MochiDirectives } from 'mochi-framework';

  let {}: MochiDirectives = $props();

  // Height only — `width` is a hard override of the measured container width, so leaving it
  // off is what lets the hydrated chart track the column.
  const HEIGHT = 260;

  const series = [
    { key: 'requests', label: 'Requests', color: seriesColors[0] },
    { key: 'cached', label: 'Cache hits', color: seriesColors[2] },
  ];
</script>

<ChartFrame height={HEIGHT}>
  <AreaChart
    data={traffic}
    x="month"
    {series}
    height={HEIGHT}
    padding={{ top: 8, right: 8, bottom: 24, left: 44 }}
    props={{
      xAxis: { rule: true },
      yAxis: { ticks: 4, format: (v: number) => `${v / 1000}k` },
      // LayerChart portals the tooltip to <body> by default, which would move it out of the
      // frame that maps its theme custom properties and leave it unstyled.
      tooltip: { root: { portal: false } },
    }}
  />
</ChartFrame>
