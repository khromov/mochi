<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<details class="disclosure">
  <summary>{title}</summary>
  <div class="disclosure-body">{@render children()}</div>
</details>

<style>
  .disclosure {
    margin: 0.5rem 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
  }

  .disclosure summary {
    cursor: pointer;
    padding: 0.55rem 0.9rem;
    font-weight: 500;
    list-style: none;
  }

  .disclosure summary::-webkit-details-marker {
    display: none;
  }

  .disclosure summary::before {
    content: '▸';
    display: inline-block;
    margin-right: 0.5rem;
    color: var(--text-subtle);
    transition: transform 0.15s ease;
  }

  .disclosure[open] summary::before {
    transform: rotate(90deg);
  }

  .disclosure-body {
    padding: 0.6rem 0.9rem 0.75rem;
    border-top: 1px solid var(--border);
  }
</style>
