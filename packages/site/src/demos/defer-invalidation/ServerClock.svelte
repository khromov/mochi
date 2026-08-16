<script>
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/utils.ts';

  let { label = '' } = $props();

  await (isServer ? delay(150, 400) : Promise.resolve());

  const renderedAt = new Date().toLocaleTimeString();
  const token = Math.random().toString(16).slice(2, 8);
</script>

<div class="clock">
  <span class="label">{label}</span>
  <span class="value">{renderedAt} · <code>{token}</code></span>
</div>

<style>
  .clock {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 1rem;
    border: 2px dashed var(--badge-info-text);
    border-radius: var(--radius-md);
    background: var(--badge-info-bg);
    color: var(--text);
  }

  .label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .value {
    font-size: 0.9rem;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }

  code {
    color: var(--badge-info-text);
  }
</style>
