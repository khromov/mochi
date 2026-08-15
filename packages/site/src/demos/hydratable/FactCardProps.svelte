<script lang="ts">
  // Alternative to `hydratable()`: the page computes `fact` server-side and passes it as a prop,
  // which Mochi devalue-serialises into the HTML and re-hydrates client-side without re-running the SSR work.
  let { fact }: { fact: { sqliteVersion: string; computedAt: string } } = $props();

  let clicks = $state(0);
</script>

<div class="card">
  <p>SQLite <strong>{fact.sqliteVersion}</strong>, server time <code>{fact.computedAt}</code></p>
  <button onclick={() => clicks++}>Clicked {clicks} times</button>
</div>

<style>
  .card {
    padding: 1rem 1.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    margin-top: 1rem;
  }
  button {
    padding: 0.4rem 0.8rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-2, var(--surface));
    color: var(--text);
    cursor: pointer;
  }
  code {
    font-size: 0.9em;
  }
</style>
