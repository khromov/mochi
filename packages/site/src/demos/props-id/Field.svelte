<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children?: Snippet<[string]> } = $props();
  const uid = $props.id();
</script>

<div class="card">
  {@render children?.(uid)}
  <p class="uid">$props.id(): <code>{uid}</code></p>
</div>

<style>
  .card {
    padding: 1rem 1.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    margin-top: 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .uid {
    margin: 0;
    flex-basis: 100%;
    color: var(--text-muted);
    font-size: 0.85em;
  }
</style>
