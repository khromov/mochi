<script lang="ts">
  import { getContext, hydratable } from 'svelte';

  type Fact = { sqliteVersion: string; computedAt: string };

  // Set by the page during SSR; undefined in the browser, where Svelte context doesn't survive hydration.
  const pageFact = getContext<Fact | undefined>('mochi-demo:fact');

  // Same key as the page's `hydratable()` call. In the browser the value comes from window.__svelte.h, so this
  // fallback must never run there. In dev, Svelte's server re-runs it to check it matches the page's value.
  const fact = await hydratable<Fact>('mochi-demo:fact', () => {
    if (!pageFact) {
      throw new Error('hydratable fallback should never run in the browser on this page');
    }
    return pageFact;
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
