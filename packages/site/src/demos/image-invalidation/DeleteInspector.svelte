<script>
  // TEMPORARY delete-cascade inspector. A hydrated island so it can log to the
  // browser console; the same events are also logged to the dev-server console.
  let { deleted = [] } = $props();

  $effect(() => {
    if (deleted.length === 0) {
      return;
    }
    console.group(`%c[image-invalidation] hard delete cascade — ${deleted.length} cached entries removed`, 'font-weight:bold');
    console.table(deleted);
    console.groupEnd();
  });
</script>

{#if deleted.length > 0}
  <div class="inspector">
    <strong>Last hard delete removed {deleted.length} cached {deleted.length === 1 ? 'entry' : 'entries'}:</strong>
    <ul>
      {#each deleted as d (d.id)}
        <li>
          <code class="kind">{d.kind}</code>
          <span class="id">{d.id}</span>
          <em>({d.reason})</em>
        </li>
      {/each}
    </ul>
    <span class="hint">The <code>variant</code> entries are your hero / card / thumb sizes. Logged to the browser console and your dev-server console too.</span>
  </div>
{/if}

<style>
  .inspector {
    margin: 1rem 0;
    padding: 0.85rem 1rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: 0.9rem;
  }
  ul {
    margin: 0.5rem 0 0.6rem;
    padding-left: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .kind {
    font-weight: 600;
  }
  .id {
    color: var(--text-muted);
    word-break: break-all;
  }
  em {
    color: var(--text-subtle);
  }
  .hint {
    color: var(--text-subtle);
    font-size: 0.82rem;
  }
</style>
