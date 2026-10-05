<script lang="ts">
  const rows = [
    { label: 'SvelteKit', share: 1, value: '5×' },
    { label: 'Mochi', share: 0.2, value: '1×', emphasis: true },
  ];
</script>

<figure class="chart">
  <figcaption class="chart-title">JavaScript shipped to the browser</figcaption>
  <ul class="rows">
    {#each rows as row (row.label)}
      <li class="row" class:emphasis={row.emphasis}>
        <span class="row-label">{row.label}</span>
        <span class="track">
          <span class="bar" style:--share={row.share}></span>
          <span class="row-value">{row.value}</span>
        </span>
      </li>
    {/each}
  </ul>
  <p class="chart-note">Relative size for the same app. The gap depends on how much of a page is interactive.</p>
</figure>

<style>
  .chart {
    --bar-muted: #a9aea3;
    margin: 0;
    padding: 1.75rem 2rem 1.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .chart {
      --bar-muted: #5a5f54;
    }
  }

  :global(:root[data-theme='dark']) .chart {
    --bar-muted: #5a5f54;
  }

  .chart-title {
    margin-bottom: 1.25rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .rows {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.9rem;
  }

  .row {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    align-items: center;
    gap: 0.9rem;
  }

  .row-label {
    font-weight: 600;
    color: var(--text);
  }

  .track {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    border-left: 1px solid var(--border-strong);
  }

  .bar {
    flex-shrink: 0;
    width: calc(var(--share) * (100% - 2.5rem));
    height: 22px;
    border-radius: 0 4px 4px 0;
    background: var(--bar-muted);
  }

  .emphasis .bar {
    background: var(--accent);
  }

  .row-value {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .emphasis .row-value {
    color: var(--text);
    font-weight: 600;
  }

  .chart-note {
    margin-top: 1.25rem;
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--text-subtle);
  }

  @media (max-width: 560px) {
    .chart {
      padding: 1.25rem 1.1rem;
    }

    .row {
      grid-template-columns: 4.5rem minmax(0, 1fr);
    }
  }
</style>
