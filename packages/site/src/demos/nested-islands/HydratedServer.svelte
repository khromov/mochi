<script>
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/sourceUtils';

  let { label = 'Hydrated server island' } = $props();
  const islandId = $props.id();

  await (isServer ? delay(600, 1200) : Promise.resolve());

  let count = $state(0);
</script>

<div class="hydrated-server">
  <p>{label} (<code>mochi:defer mochi:hydrate</code>)</p>
  <p class="meta">$props.id(): <strong>{islandId}</strong></p>
  <button onclick={() => count++}>Hydrated, clicked <strong>{count}</strong> times</button>
</div>

<style>
  .hydrated-server {
    padding: 0.85rem 1rem;
    border: 2px dashed var(--badge-success-text, var(--badge-info-text));
    border-radius: var(--radius-md);
    background: var(--badge-success-bg, var(--badge-info-bg));
    color: var(--text);
    margin-top: 0.6rem;
  }

  .hydrated-server p {
    margin: 0 0 0.35rem;
  }

  .meta {
    font-size: 0.92em;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  button {
    padding: 0.4rem 0.8rem;
    border: 2px solid var(--badge-info-text);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  code {
    font-family: var(--font-mono);
  }
</style>
