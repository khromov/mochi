<script>
  let { label = '' } = $props();

  const renderedAt = new Date().toLocaleTimeString();

  if (Math.random() < 0.5) {
    throw new Error('Upstream service returned 503');
  }
</script>

<div class="ok">
  <span class="label">{label}</span>
  <span class="value">rendered {renderedAt}</span>
</div>

<style>
  .ok {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 3.5rem;
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
</style>
