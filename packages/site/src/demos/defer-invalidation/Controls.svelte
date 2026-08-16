<script>
  import { reloadDeferredIsland, reloadDeferredIslandAll, isReloadingDeferredIsland } from 'mochi-framework';
  import { reloads } from './reloadCount.svelte.ts';

  let status = $state('');

  async function run(name) {
    // Synchronous, so the handler can bail before starting anything. Click twice quickly to see it.
    if (isReloadingDeferredIsland(name)) {
      status = `"${name}" is already reloading — click ignored`;
      return;
    }
    status = `reloading "${name}"…`;
    try {
      await reloadDeferredIsland(name);
      reloads.count++;
      status = '';
    } catch {
      status = `"${name}" failed to reload`;
    }
  }

  async function runAll() {
    status = 'reloading all…';
    try {
      await reloadDeferredIslandAll();
      reloads.count++;
      status = '';
    } catch {
      status = 'reload all failed';
    }
  }
</script>

<div class="controls">
  <div class="buttons">
    <button onclick={() => run('single')}>Reload single</button>
    <button onclick={() => run('pair')}>Reload pair (×2)</button>
    <button onclick={() => run('live')}>Reload hydrated</button>
    <button onclick={runAll}>Reload all</button>
  </div>
  <p class="status" class:empty={status === ''}>{status || ' '}</p>
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

  .status {
    margin: 0;
    min-height: 1.2em;
    font-size: 0.85rem;
    font-family: var(--font-mono);
    color: var(--badge-info-text);
  }

  .status.empty {
    visibility: hidden;
  }

  .count {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-subtle);
    font-variant-numeric: tabular-nums;
  }
</style>
