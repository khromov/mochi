<script>
  import { isBrowser, logger } from 'mochi-framework';
  if (isBrowser) {
    logger.info('PokemonStats is hydrating!');
  }
  const { stats } = $props();
  const maxStat = 255;
  let filter = $state('');
  const filtered = $derived(filter.trim() === '' ? stats : stats.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase())));
</script>

<div class="stats">
  <h2>Base Stats</h2>
  <input class="filter" type="search" placeholder="Filter stats…" bind:value={filter} />
  {#each filtered as s (s.name)}
    <div class="row">
      <span class="name">{s.name}</span>
      <span class="num">{s.value}</span>
      <div class="bar-track">
        <div class="bar" style="width:{Math.round((s.value / maxStat) * 100)}%"></div>
      </div>
    </div>
  {/each}
</div>

<style>
  .stats {
    padding: 0 1.5rem 1.5rem;
  }

  .stats h2 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-weight: 600;
    margin: 0 0 0.75rem;
  }

  .row {
    display: grid;
    grid-template-columns: 80px 36px 1fr;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.45rem;
  }

  .name {
    font-size: 0.8rem;
    color: var(--text-muted);
    text-transform: capitalize;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .num {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    font-family: var(--font-mono);
    text-align: right;
  }

  .filter {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 0.75rem;
    padding: 0.3rem 0.5rem;
    font-size: 0.85rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    outline: none;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }

  .filter:focus-visible {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .bar-track {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: 999px;
    height: 6px;
    overflow: hidden;
  }

  .bar {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--accent-soft), var(--accent));
    min-width: 4px;
  }
</style>
