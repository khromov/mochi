<script lang="ts">
  import { isHydratable } from 'mochi-framework';
  import Badge from '../../components/Badge.svelte';
  import Self from './HydrationProbe.svelte';

  let { depth = 1, max = 3 }: { depth?: number; max?: number } = $props();

  const hydratable = isHydratable();
</script>

<div class="probe">
  <div class="row">
    <span class="name">Depth {depth}</span>
    <code>isHydratable()</code>
    <Badge kind={hydratable ? 'success' : 'info'}>{String(hydratable)}</Badge>
  </div>
  {#if depth < max}
    <Self depth={depth + 1} {max} />
  {/if}
</div>

<style>
  .probe {
    padding: 0.6rem 0.8rem;
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .name {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text);
  }

  .row code {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  @media (max-width: 480px) {
    .row {
      flex-wrap: wrap;
    }

    .row :global(.badge) {
      flex-basis: 100%;
    }
  }
</style>
