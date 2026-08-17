<script>
  import { reloadDeferredIsland, reloadDeferredIslandAll, deferReloadState } from 'mochi-framework';

  const one = deferReloadState('1');
  const pair = deferReloadState('2-and-3');

  // Includes the error-mode islands below, since "reload all" reaches every named island.
  const anyReloading = $derived([one, pair, deferReloadState('flaky'), deferReloadState('offline')].some((s) => s.reloading));

  const stamp = (s) => (s.lastReloaded ? `${s.lastReloadOk ? 'ok' : 'failed'} at ${s.lastReloaded.toLocaleTimeString()}` : 'not yet reloaded');
</script>

<div class="controls">
  <div class="buttons">
    <button disabled={one.reloading} onclick={() => reloadDeferredIsland('1')}>Reload 1</button>
    <button disabled={pair.reloading} onclick={() => reloadDeferredIsland('2-and-3')}>Reload 2 + 3</button>
    <button disabled={anyReloading} onclick={() => reloadDeferredIslandAll()}>Reload all</button>
  </div>

  <dl class="state">
    <div>
      <dt>Island 1</dt>
      <dd>{one.count} reloads · {stamp(one)}</dd>
    </div>
    <div>
      <dt>Islands 2 + 3</dt>
      <dd>{pair.count} reloads · {stamp(pair)}</dd>
    </div>
  </dl>
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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
    opacity: 0.5;
    cursor: not-allowed;
    border-style: dashed;
    background: var(--surface-muted);
    color: var(--text-subtle);
  }

  .state {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: 0.35rem 1rem;
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-subtle);
    font-variant-numeric: tabular-nums;
  }

  .state div {
    display: flex;
    gap: 0.4rem;
  }

  dt {
    font-weight: 600;
  }

  dt::after {
    content: ':';
  }

  dd {
    margin: 0;
    font-family: var(--font-mono);
  }
</style>
