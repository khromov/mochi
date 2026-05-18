<script lang="ts">
  // Alternative to hydratable(): the page computes `fact` server-side and
  // passes it in as a prop. Mochi devalue-serialises island props into the
  // HTML and re-hydrates them on the client, so the data still crosses the
  // wire without re-running the SSR work — just via a different channel.
  let { fact } = $props<{ fact: { sqliteVersion: string; computedAt: string } }>();

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
    cursor: pointer;
  }
  code {
    font-size: 0.9em;
  }
</style>
