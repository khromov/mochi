<script lang="ts">
  let { label = 'Clicks' }: { label?: string } = $props();
  let count = $state(0);
</script>

<button type="button" class="counter" onclick={() => count++}>
  {label}: <strong>{count}</strong>
</button>

<style>
  .counter {
    font: inherit;
    padding: 0.55rem 1rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }

  .counter:hover {
    background: var(--accent);
    color: var(--surface);
  }
</style>
