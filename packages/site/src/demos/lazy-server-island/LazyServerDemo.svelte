<script>
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/sourceUtils';

  let { index = 0 } = $props();

  await (isServer ? delay(200, 600) : Promise.resolve());

  const renderedAt = new Date().toLocaleTimeString();
</script>

<div class="lazy-server">
  <span class="index">#{index}</span>
  <span class="status">Fetched at {renderedAt}</span>
</div>

<style>
  .lazy-server {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1rem;
    border: 2px dashed var(--badge-info-text);
    border-radius: var(--radius-md);
    background: var(--badge-info-bg);
    color: var(--text);
  }

  .index {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .status {
    font-size: 0.85rem;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
</style>
