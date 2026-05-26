<script lang="ts">
  import { hydratable } from 'svelte';

  // Same key as the page. During SSR, Svelte memoises by key so this body
  // never runs (the page populated the cache first). During client hydration,
  // hydratable() returns the value from window.__svelte.h without invoking
  // fn(). The throw is an executable assertion: if the contract ever broke,
  // the page would crash visibly instead of silently regressing performance.
  const fact = await hydratable<{ sqliteVersion: string; computedAt: string }>('mochi-demo:fact', () => {
    throw new Error('hydratable fallback should never run on this page');
  });

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
