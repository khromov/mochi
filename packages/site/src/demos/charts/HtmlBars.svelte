<script lang="ts">
  import { BarChart } from 'layerchart/html';
  import ChartFrame from './ChartFrame.svelte';
  import { traffic, seriesColors } from './data.ts';

  const HEIGHT = 260;

  const series = [
    { key: 'requests', label: 'Requests', color: seriesColors[0] },
    { key: 'cached', label: 'Cache hits', color: seriesColors[2] },
  ];
</script>

<ChartFrame height={HEIGHT}>
  <!-- Hydrated, so the client measures the container: no `width`, no `ssr` — the frame arrives
       empty and the chart draws (and reflows) once the island boots. Leaving `ssr` off also keeps
       the <BarChart> shortcut usable here; forcing a server render would hit its `marks` recursion. -->
  <BarChart
    data={traffic}
    x="month"
    {series}
    seriesLayout="group"
    legend
    height={HEIGHT}
    padding={{ top: 8, right: 8, bottom: 56, left: 44 }}
    props={{
      xAxis: { rule: true },
      yAxis: { ticks: 4, format: (v: number) => `${v / 1000}k` },
      tooltip: { root: { portal: false } },
    }}
  />
</ChartFrame>
