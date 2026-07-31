<script lang="ts">
  import { BarChart } from 'layerchart/svg';
  import ChartFrame from './ChartFrame.svelte';
  import { bundles, seriesColors } from './data.ts';

  const HEIGHT = 280;

  let layout = $state<'stack' | 'group'>('stack');

  const series = [
    { key: 'html', label: 'HTML', color: seriesColors[0] },
    { key: 'islands', label: 'Islands', color: seriesColors[1] },
    { key: 'css', label: 'CSS', color: seriesColors[2] },
  ];
</script>

<div class="controls" role="group" aria-label="Series layout">
  <button type="button" aria-pressed={layout === 'stack'} class:active={layout === 'stack'} onclick={() => (layout = 'stack')}>Stacked</button>
  <button type="button" aria-pressed={layout === 'group'} class:active={layout === 'group'} onclick={() => (layout = 'group')}>Grouped</button>
</div>

<ChartFrame height={HEIGHT}>
  <BarChart
    data={bundles}
    x="route"
    {series}
    seriesLayout={layout}
    legend
    height={HEIGHT}
    padding={{ top: 8, right: 8, bottom: 56, left: 44 }}
    props={{
      xAxis: { rule: true },
      yAxis: { ticks: 4, format: (v: number) => `${v} KB` },
      tooltip: { root: { portal: false } },
    }}
  />
</ChartFrame>

<style>
  .controls {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .controls button {
    font: inherit;
    font-size: 0.9rem;
    padding: 0.35rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }
  .controls button:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }
  .controls button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .controls button.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
    font-weight: 600;
  }
</style>
