<script lang="ts">
  import { ServerChart } from 'layerchart/server';
  import type { CaptureTarget } from 'layerchart/server';
  import { Axis, Grid, Spline } from 'layerchart';
  import type { TrafficPoint } from './data.ts';

  let {
    data,
    width,
    height,
    capture,
    onCapture,
  }: {
    data: TrafficPoint[];
    width: number;
    height: number;
    capture?: CaptureTarget;
    onCapture?: (data: CaptureTarget) => void;
  } = $props();
</script>

<ServerChart {capture} {onCapture} {width} {height} {data} x="month" y="requests" yDomain={[0, null]} padding={{ top: 16, right: 20, bottom: 28, left: 48 }}>
  <Grid y stroke="rgba(148,163,184,0.3)" />
  <Axis placement="left" rule ticks={4} format={(v: number) => `${v / 1000}k`} stroke="rgba(100,116,139,0.4)" fill="rgba(71,85,105,0.9)" />
  <Axis placement="bottom" rule stroke="rgba(100,116,139,0.4)" fill="rgba(71,85,105,0.9)" />
  <Spline stroke="rgb(59,130,246)" strokeWidth={2} />
</ServerChart>
