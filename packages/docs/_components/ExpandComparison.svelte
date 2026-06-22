<script lang="ts">
  import { comparisonOpen, setComparisonOpen } from './comparison.svelte.ts';

  // A plain string prop (not a children snippet) — snippet slot content is not
  // passed across the island's SSR→client hydration boundary, but props are.
  let { label = 'Expand the table below' }: { label?: string } = $props();

  // Once the table is expanded, keep the text but drop the link.
  const expanded = $derived(comparisonOpen() === true);
</script>

{#if expanded}
  {label}
{:else}
  <button type="button" class="expand-link" onclick={() => setComparisonOpen(true)}>{label}</button>
{/if}

<style>
  .expand-link {
    display: inline;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }
  .expand-link:hover {
    color: var(--accent-hover);
  }
</style>
