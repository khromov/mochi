<script>
  import { reloadDeferredIsland, reloadDeferredIslandAll, isReloadingDeferredIsland } from 'mochi-framework';
  import { reloads } from './reloadCount.svelte.ts';

  let status = $state('');

  // The events bubble to the document, so every bit of this status is driven by the islands
  // themselves rather than by the code that started the reload.
  $effect(() => {
    const onStart = (e) => (status = `reloading "${e.detail.name}"…`);
    const onEnd = (e) => {
      reloads.count++;
      status = e.detail.ok ? '' : `"${e.detail.name}" failed to reload`;
    };
    document.addEventListener('mochi:island:reloadstart', onStart);
    document.addEventListener('mochi:island:reloadend', onEnd);
    return () => {
      document.removeEventListener('mochi:island:reloadstart', onStart);
      document.removeEventListener('mochi:island:reloadend', onEnd);
    };
  });

  function run(name) {
    // Synchronous, so the handler can bail before starting anything. Click twice quickly to see it.
    if (isReloadingDeferredIsland(name)) {
      status = `"${name}" is already reloading — click ignored`;
      return;
    }
    reloadDeferredIsland(name);
  }
</script>

<div class="controls">
  <div class="buttons">
    <button onclick={() => run('1')}>Reload 1</button>
    <button onclick={() => run('2-and-3')}>Reload 2 + 3</button>
    <button onclick={() => reloadDeferredIslandAll()}>Reload all</button>
  </div>
  <p class="status" class:empty={status === ''}>{status || ' '}</p>
  <p class="count">Island reloads completed: <strong>{reloads.count}</strong> <span class="via">(counted from mochi:island:reloadend)</span></p>
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

  .via {
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: 0.8em;
  }

  .count {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-subtle);
    font-variant-numeric: tabular-nums;
  }
</style>
