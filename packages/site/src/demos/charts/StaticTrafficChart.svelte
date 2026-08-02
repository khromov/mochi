<script lang="ts">
  import { Chart, Layer, Axis, Area } from 'layerchart/svg';
  import ChartFrame from './ChartFrame.svelte';
  import { traffic } from './data.ts';

  // Composed from <Chart> rather than the <AreaChart> shortcut the hydrated cards use, because
  // that shortcut renders a `marks` snippet that shadows its own `marks` prop — which Svelte's
  // server compiler turns into unbounded recursion.
  //
  // `ssr` and both dimensions are mandatory here rather than optimisations: LayerChart skips
  // rendering on the server unless asked, and its chart state starts at 100x100 and only
  // corrects itself from a `bind:clientWidth` that never fires without hydration.
  const WIDTH = 600;
  const HEIGHT = 220;
</script>

<ChartFrame height={HEIGHT}>
  <Chart ssr data={traffic} x="month" y="requests" yDomain={[0, null]} yNice width={WIDTH} height={HEIGHT} padding={{ top: 8, right: 8, bottom: 24, left: 44 }}>
    <Layer>
      <Axis placement="left" grid rule ticks={4} format={(v: number) => `${v / 1000}k`} />
      <Axis placement="bottom" rule />
      <!-- The composable <Area> takes its colour from the series it belongs to, and this chart
           declares no series, so it needs one explicitly. -->
      <Area fill="var(--chart-1)" fillOpacity={0.3} line={{ stroke: 'var(--chart-1)', strokeWidth: 2 }} />
    </Layer>
  </Chart>
</ChartFrame>
