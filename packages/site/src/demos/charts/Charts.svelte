<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import StaticTrafficChart from './StaticTrafficChart.svelte';
  import TrafficChart from './TrafficChart.svelte';
  import BundleBars from './BundleBars.svelte';
  import RuntimeDonut from './RuntimeDonut.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { highlightCode } from '../../lib/highlight.server';
  import { files } from './files.ts';

  const install = await highlightCode('bun add layerchart', 'bash');

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Charts with LayerChart"
  description="LayerChart is a Svelte 5 charting library that renders to plain SVG, so it server-renders like any other component. The first chart below ships no JavaScript at all; the rest are islands — two mochi:hydrate, one mochi:clientOnly — sharing a single client chunk."
  {sources}
>
  <p>
    LayerChart needs no special setup. It's a plain Svelte 5 runes library — its only peer dependency is <code>svelte ^5</code>, it brings its own styles, and it doesn't require
    Tailwind. Install it and import from <code>layerchart</code>; Mochi compiles it out of <code>node_modules</code> like any other Svelte component and bundles it into whichever island
    imports it.
  </p>
  <CodeSnippet html={install} />
  <p>
    The charts here import from the <code>layerchart/svg</code> subpath, which drops the canvas and HTML renderers from the bundle. Colours come from the
    <code>--color-primary</code> and <code>--color-surface-*</code> custom properties LayerChart reads off its own <code>.lc-root-container</code>, remapped onto this site's theme
    tokens — the docs' Tailwind class names wouldn't do anything here. Full component reference at
    <a href="https://www.layerchart.com" target="_blank" rel="noopener noreferrer">layerchart.com</a>.
  </p>

  <h2>No directive — pure SSR</h2>
  <p>
    No hydration directive, so no LayerChart code reaches the browser: the SVG below is generated on the server and is inert. Two things are required to make that work. LayerChart
    skips server rendering by default, so the chart opts in with <code>ssr</code>; and since nothing measures the container on the client, both <code>width</code> and
    <code>height</code> have to be passed explicitly — the chart state starts at 100&times;100 and otherwise only corrects itself from a <code>bind:clientWidth</code> that never fires
    here. A fixed width is the trade: this one can't be responsive, so it scrolls on narrow screens.
  </p>
  <StaticTrafficChart />

  <h2>Interactive — <code>mochi:hydrate</code></h2>
  <p>
    Same library, two series, hydrated. Hover the plot for the crosshair and tooltip. This one leaves <code>ssr</code> off, so the frame arrives empty and the chart draws once the
    island boots — that's what buys the responsive width, since passing <code>width</code> would override the measured container width. The frame reserves its height up front so nothing
    shifts when the chart appears.
  </p>
  <TrafficChart mochi:hydrate />

  <h2>Bars with a layout toggle</h2>
  <p>
    <code>seriesLayout</code> is driven by a <code>$state</code> rune, so switching between stacked and grouped is a reactive prop change. Before the island hydrates the buttons are
    server-rendered but inert.
  </p>
  <BundleBars mochi:hydrate />

  <h2>Donut — <code>mochi:clientOnly</code></h2>
  <p>
    A <code>PieChart</code> with a negative <code>innerRadius</code> (an inset from the outer radius), coloured through <code>cRange</code>. Click a legend swatch to toggle a
    slice.
  </p>
  <p>
    This one uses <code>mochi:clientOnly</code> rather than <code>mochi:hydrate</code>, which is usually the better fit for a chart. Since LayerChart draws nothing on the server
    unless you ask for it, hydrating means server-rendering an empty container and then reconciling it — whereas a client-only island skips the server pass entirely, mounts in the
    browser, and lets you ship real fallback markup in the meantime. The skeleton below is passed as children and is wiped the moment the component mounts.
  </p>
  <RuntimeDonut mochi:clientOnly>
    <div class="skeleton">Loading chart…</div>
  </RuntimeDonut>
</DemoPage>

<style>
  p {
    margin: 0 0 0.75rem;
    font-size: 0.95rem;
    color: var(--text-muted);
    line-height: 1.55;
  }

  p a {
    color: var(--accent);
    font-weight: 600;
  }

  .skeleton {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 324px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text-subtle);
    font-size: 0.9rem;
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
</style>
