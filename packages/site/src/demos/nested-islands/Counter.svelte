<script>
  let { label = 'Counter' } = $props();
  let count = $state(0);
</script>

<button class="counter" onclick={() => count++}>{label}: <strong>{count}</strong></button>

<style>
  .counter {
    padding: 0.4rem 0.8rem;
    border: 2px solid var(--badge-info-text);
    border-radius: var(--radius-md);
    background: var(--badge-info-bg);
    color: var(--text);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
</style>
