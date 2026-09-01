<script lang="ts">
  import type { Snippet } from 'svelte';
  import { isBrowser } from 'mochi-framework';
  import Badge from '../../components/Badge.svelte';
  import type { MochiDirectives } from 'mochi-framework';

  let { label = 'Target', children }: { label?: string; children?: Snippet } & MochiDirectives = $props();

  let count = $state(0);
  const renderedAt = new Date().toLocaleTimeString();
</script>

<div class="target" class:hydrated={isBrowser}>
  <div class="header">
    <span class="label">{label}</span>
    <Badge kind={isBrowser ? 'success' : 'info'}>
      {isBrowser ? 'hydrated' : 'server-rendered only'}
    </Badge>
  </div>
  <div class="meta">rendered at <code>{renderedAt}</code></div>
  <button onclick={() => count++}>
    Clicked {count}
    {count === 1 ? 'time' : 'times'}
  </button>
  {#if !isBrowser}
    <p class="note">This button won't work since the component is not hydrated!</p>
  {/if}
  {@render children?.()}
</div>

<style>
  .target {
    padding: 1rem 1.25rem;
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    transition:
      border-color 0.12s ease,
      background 0.12s ease;
  }

  .target.hydrated {
    border-color: var(--badge-success-text);
    background: var(--badge-success-bg);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .label {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 1.05rem;
    color: var(--text);
  }

  .meta {
    font-size: 0.95rem;
    color: var(--text-muted);
  }

  code {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.9em;
  }

  button {
    align-self: flex-start;
    font: inherit;
    font-size: 1rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  button:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  button:focus-visible {
    box-shadow: var(--focus-ring);
    outline: none;
  }

  .note {
    margin: 0;
    font-size: 0.9rem;
    color: var(--badge-warning-text);
  }
</style>
