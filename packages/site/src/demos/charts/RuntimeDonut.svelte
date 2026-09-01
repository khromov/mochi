<script lang="ts">
  import type { ClientOnlyProps, MochiDirectives } from 'mochi-framework';
  import { PieChart } from 'layerchart/svg';
  import ChartFrame from './ChartFrame.svelte';
  import { runtimes, seriesColors } from './data.ts';

  let { height = 300 }: ClientOnlyProps<{ height?: number }> & MochiDirectives = $props();
</script>

<ChartFrame {height}>
  <PieChart
    data={runtimes}
    key="stage"
    value="ms"
    cRange={seriesColors}
    innerRadius={-36}
    cornerRadius={2}
    padAngle={0.02}
    legend
    {height}
    padding={{ bottom: 40 }}
    props={{ tooltip: { root: { portal: false } } }}
  />
</ChartFrame>
