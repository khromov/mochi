<script lang="ts">
  import type { Snippet } from 'svelte';
  import ThrowOnClient from './ThrowOnClient.svelte';

  let { children: _children }: { children?: Snippet } = $props();
</script>

<div class="card">
  <p>The server island itself rendered successfully.</p>
  <p>
    Inside it sits a <code>mochi:hydrate</code> child that throws on the client — its boundary catches the failure independently:
  </p>
  <ThrowOnClient mochi:hydrate label="ThrowOnClient (inside server island)" />
</div>

<style>
  .card {
    padding: 1rem 1.25rem;
    background: var(--surface-muted);
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .card p {
    margin: 0;
    font-size: 0.95rem;
  }

  .card code {
    font-family: var(--font-mono);
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 0.05em 0.3em;
    border-radius: 4px;
    font-size: 0.85em;
  }
</style>
