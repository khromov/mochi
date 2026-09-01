<script lang="ts">
  import { hydratable } from 'svelte';
  import type { MochiDirectives } from 'mochi-framework';

  let {}: MochiDirectives = $props();

  // Same key as the page's `hydratable()` call, so this closure never actually runs — the throw
  // is an assertion that fires loudly if that invariant ever breaks.
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
