<script lang="ts">
  import { Chart, Svg, Axis, Bars } from 'layerchart/svg';
  import ChartFrame from './ChartFrame.svelte';
  import { traffic } from './data.ts';

  // No hydration, so nothing measures the container on the client: `ssr` opts LayerChart into
  // server rendering, and width/height bake the coordinate space at render time. The chart stays
  // responsive anyway because the <Svg> carries a matching `viewBox` — the fixed 600x220 geometry
  // then scales to the column via CSS (see the .lc-root-container override below).
  //
  // Composed from <Chart> primitives rather than the <BarChart> shortcut: that shortcut's `marks`
  // snippet shadows its own `marks` prop, which the Svelte server compiler turns into unbounded
  // recursion once `ssr` forces a server render. See layerchart-repro/ for a standalone repro.
  const WIDTH = 600;
  const HEIGHT = 220;
</script>

<div class="ssr-chart" style="--ar: {WIDTH} / {HEIGHT}">
  <ChartFrame height={HEIGHT}>
    <Chart
      ssr
      data={traffic}
      x="month"
      y="requests"
      yDomain={[0, null]}
      yNice
      c="requests"
      cRange={['var(--chart-1)']}
      bandPadding={0.2}
      width={WIDTH}
      height={HEIGHT}
      padding={{ top: 8, right: 8, bottom: 24, left: 44 }}
    >
      <Svg viewBox="0 0 {WIDTH} {HEIGHT}">
        <Axis placement="left" grid rule ticks={4} format={(v: number) => `${v / 1000}k`} />
        <Axis placement="bottom" rule />
        <Bars fill="var(--chart-1)" fillOpacity={0.85} />
      </Svg>
    </Chart>
  </ChartFrame>
</div>

<style>
  /* The chart's width/height are baked at SSR, so override the fixed px container with a fluid
     one; the <Svg viewBox> scales the 600x220 geometry down to fit any column, no JS involved. */
  .ssr-chart :global(.lc-root-container) {
    width: 100% !important;
    height: auto !important;
    aspect-ratio: var(--ar);
    /* Clip the invisible tooltip-context layer, which sits at the left-padding offset and would
       otherwise overhang the fluid container by a few dozen px. */
    overflow: hidden;
  }

  /* The layer <svg> is inset:0 inside these tooltip-context wrappers, which LayerChart pins to the
     baked 600px width — so the svg fills 600px and overflows. Make the wrappers fluid and the svg
     follows the (now responsive) column. */
  .ssr-chart :global(.lc-tooltip-context),
  .ssr-chart :global(.lc-tooltip-context-container),
  .ssr-chart :global(svg.lc-layout-svg) {
    width: 100% !important;
    height: 100% !important;
  }
</style>
