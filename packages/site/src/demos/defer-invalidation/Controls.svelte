<script>
  import { reloadDeferredIsland, reloadDeferredIslandAll } from 'mochi-framework';
  import { reloads } from './reloadCount.svelte.ts';

  let pending = $state('');

  async function run(name, fn) {
    pending = name;
    await fn();
    reloads.count++;
    pending = '';
  }
</script>

<div class="controls">
  <div class="buttons">
    <button disabled={pending !== ''} onclick={() => run('single', () => reloadDeferredIsland('single'))}>
      {pending === 'single' ? 'Reloading…' : 'Reload single'}
    </button>
    <button disabled={pending !== ''} onclick={() => run('pair', () => reloadDeferredIsland('pair'))}>
      {pending === 'pair' ? 'Reloading…' : 'Reload pair (×2)'}
    </button>
    <button disabled={pending !== ''} onclick={() => run('live', () => reloadDeferredIsland('live'))}>
      {pending === 'live' ? 'Reloading…' : 'Reload hydrated'}
    </button>
    <button disabled={pending !== ''} onclick={() => run('all', reloadDeferredIslandAll)}>
      {pending === 'all' ? 'Reloading…' : 'Reload all'}
    </button>
  </div>
  <p class="count">Reloads completed: <strong>{reloads.count}</strong></p>
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  button {
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.55;
    cursor: progress;
  }

  .count {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-subtle);
    font-variant-numeric: tabular-nums;
  }
</style>
