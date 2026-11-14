<script lang="ts">
  // Reads the browser's own resource timings, so the count is what actually went over the wire.
  let requests = $state<string[]>([]);

  $effect(() => {
    const record = (entries: PerformanceEntryList) => {
      const added = entries.map((e) => new URL(e.name).pathname).filter((p) => p.includes('/island'));
      if (added.length > 0) {
        requests = [...requests, ...added];
      }
    };
    record(performance.getEntriesByType('resource'));
    const observer = new PerformanceObserver((list) => record(list.getEntries()));
    observer.observe({ type: 'resource', buffered: true });
    return () => observer.disconnect();
  });

  const grouped = $derived(requests.filter((p) => p.includes('/island-group/')));
  const single = $derived(requests.filter((p) => !p.includes('/island-group/')));
</script>

<div class="log">
  <p>
    <strong>{grouped.length}</strong>
    group {grouped.length === 1 ? 'request' : 'requests'} for the 8 grouped badges ·
    <strong>{single.length}</strong>
    separate {single.length === 1 ? 'request' : 'requests'} for the 3 ungrouped ones
  </p>
  <ul>
    {#each requests as path, i (i)}
      <li>{path}</li>
    {/each}
  </ul>
</div>

<style>
  .log {
    padding: 0.85rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
  }

  .log p {
    margin: 0 0 0.5rem;
  }

  .log ul {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
</style>
