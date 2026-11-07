<script>
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/sourceUtils';

  let { label = 'Inner server island' } = $props();
  const islandId = $props.id();

  await (isServer ? delay(600, 1200) : Promise.resolve());

  const randomNumber = Math.floor(Math.random() * 1000);
</script>

<div class="inner-server">
  <p>{label} (<code>mochi:defer</code>)</p>
  <p class="meta">Random number from the server: <strong>{randomNumber}</strong></p>
  <p class="meta">$props.id(): <strong>{islandId}</strong></p>
</div>

<style>
  .inner-server {
    padding: 0.85rem 1rem;
    border: 2px dashed var(--badge-warning-text);
    border-radius: var(--radius-md);
    background: var(--badge-warning-bg);
    color: var(--text);
  }

  .inner-server p {
    margin: 0 0 0.35rem;
  }

  .inner-server p:last-child {
    margin-bottom: 0;
  }

  .meta {
    font-size: 0.92em;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  code {
    font-family: var(--font-mono);
  }
</style>
