<script lang="ts">
  import { isBrowser } from 'mochi-framework';
  import Badge from '../../components/Badge.svelte';
  import Self from './Level.svelte';

  let { depth = 1, max = 5 }: { depth?: number; max?: number } = $props();

  let Next = $state(Self);
  let count = $state(0);

  const tag = $derived(depth === 1 ? ' (root)' : depth === max ? ' (leaf)' : '');
</script>

<div class="level" class:hydrated={isBrowser}>
  <div class="header">
    <span class="name">Level {depth}{tag}</span>
    <Badge kind={isBrowser ? 'success' : 'info'}>
      {isBrowser ? 'hydrated' : 'SSR only'}
    </Badge>
  </div>
  <button onclick={() => count++}>L{depth} clicked {count} {count === 1 ? 'time' : 'times'}</button>
  {#if depth < max}
    <Next depth={depth + 1} {max} />
  {/if}
</div>

<style>
  .level {
    padding: 0.65rem 0.85rem;
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

  .level.hydrated {
    border-color: var(--badge-success-text);
    background: var(--badge-success-bg);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .name {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text);
  }

  button {
    align-self: flex-start;
    font: inherit;
    font-size: 0.9rem;
    padding: 0.35rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  button:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }
</style>
