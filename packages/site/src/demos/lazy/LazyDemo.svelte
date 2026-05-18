<script>
  import { isBrowser } from 'mochi-framework';

  let { index = 0 } = $props();
  const rand = isBrowser ? Math.random().toFixed(4) : null;
</script>

<div class="lazy-demo">
  <span class="index">#{index}</span>
  {#if isBrowser}
    <span class="status hydrated">Hydrated! {rand}</span>
  {:else}
    <span class="status waiting">Waiting to hydrate...</span>
  {/if}
</div>

<style>
  .lazy-demo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .index {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .status {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .status.waiting {
    background: var(--badge-warning-bg);
    color: var(--badge-warning-text);
  }

  .status.hydrated {
    background: var(--badge-success-bg);
    color: var(--badge-success-text);
  }
</style>
