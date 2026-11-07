<script lang="ts">
  import { StateHistory, PersistedState, IsMounted } from 'runed';
  import Badge from '../../components/Badge.svelte';

  let count = $state(0);
  const history = new StateHistory(
    () => count,
    (c) => (count = c),
  );

  const persisted = new PersistedState('mochi-runed-demo:count', 0);

  const isMounted = new IsMounted();
</script>

<div class="grid">
  <div class="card">
    <div class="head">
      <h3>StateHistory</h3>
      <span class="hint">undo / redo any $state</span>
    </div>
    <div class="counter">
      <button onclick={() => count--}>−</button>
      <span class="value">{count}</span>
      <button onclick={() => count++}>+</button>
    </div>
    <div class="actions">
      <button onclick={history.undo} disabled={!history.canUndo}>Undo</button>
      <button onclick={history.redo} disabled={!history.canRedo}>Redo</button>
    </div>
    <p class="meta">{history.log.length} snapshot{history.log.length === 1 ? '' : 's'} recorded</p>
  </div>

  <div class="card">
    <div class="head">
      <h3>PersistedState</h3>
      <span class="hint">localStorage · survives reload · syncs tabs</span>
    </div>
    <div class="counter">
      <button onclick={() => persisted.current--}>−</button>
      <span class="value">{persisted.current}</span>
      <button onclick={() => persisted.current++}>+</button>
    </div>
    <p class="meta">Reload the page — the value sticks. Open a second tab to watch it sync.</p>
  </div>

  <div class="card mounted">
    <div class="head">
      <h3>IsMounted</h3>
      <span class="hint">false during SSR, true after hydration</span>
    </div>
    {#if isMounted.current}
      <Badge kind="success">mounted (client)</Badge>
    {:else}
      <Badge kind="warning">not mounted (server)</Badge>
    {/if}
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
  }

  .card.mounted {
    align-items: flex-start;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .head h3 {
    font-size: 1rem;
    font-weight: 700;
    margin: 0;
    color: var(--text);
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-subtle);
  }

  .counter {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .value {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--accent);
    min-width: 2ch;
    text-align: center;
  }

  .actions {
    display: flex;
    gap: 0.4rem;
  }

  button {
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }

  button:hover:not(:disabled) {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .meta {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
  }
</style>
