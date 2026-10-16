<script lang="ts">
  import { onMount } from 'svelte';
  import { Chart, Svg, Grid, Line, Axis, Crosshair } from '@faintshadow/flarecharts';
  import { TRAFFIC_SEED, type Point } from '../lib/analytics';

  // Hydrated island (mochi:hydrate). <Chart> is responsive — it measures its
  // container on the client, so on the server it renders an empty (0-size) plot
  // and fills in on hydration. The deterministic seed keeps SSR === first client
  // render; live points are appended only after mount.
  let points = $state<Point[]>([...TRAFFIC_SEED]);

  const MAX_POINTS = 40;

  onMount(() => {
    const id = setInterval(() => {
      const last = points[points.length - 1] ?? { t: 0, v: 120 };
      const next = Math.round(Math.min(220, Math.max(40, last.v + (Math.random() - 0.5) * 44)));
      points = [...points.slice(-(MAX_POINTS - 1)), { t: last.t + 1, v: next }];
    }, 1500);
    return () => clearInterval(id);
  });
</script>

<div style="height: 220px">
  <!-- Composed from primitives (not the one-tag <LineChart>) so we can turn off
       the screen-reader data table and keyboard nav. For a continuously-updating
       live series those grow a row/announcement per point and add nothing — the
       label below still names the chart for assistive tech. -->
  <Chart label="Live request volume — requests per minute" dataTable={false} keyboard={false}>
    <Svg>
      <Grid y />
      <Line data={points} x={(d: Point) => d.t} y={(d: Point) => d.v} name="Requests / min" />
      <Crosshair />
      <Axis placement="left" />
      <Axis placement="bottom" />
    </Svg>
  </Chart>
</div>
