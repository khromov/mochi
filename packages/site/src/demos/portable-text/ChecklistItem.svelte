<script lang="ts">
  import type { ListItemComponentProps } from '@portabletext/svelte';
  import type { Snippet } from 'svelte';
  import Square from '@lucide/svelte/icons/square';
  import SquareCheckBig from '@lucide/svelte/icons/square-check-big';

  let { portableText, children }: { portableText: ListItemComponentProps; children: Snippet } = $props();

  // `checked` is ours, not part of the Portable Text spec, so the toolkit type doesn't declare it.
  let checked = $derived(Boolean((portableText.value as { checked?: boolean }).checked));
</script>

<li class:done={checked}>
  {#if checked}
    <SquareCheckBig size={15} aria-hidden="true" />
  {:else}
    <Square size={15} aria-hidden="true" />
  {/if}
  <span>{@render children()}</span>
</li>

<style>
  li {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.9rem;
    color: var(--text);
  }

  .done {
    color: var(--text-subtle);
    text-decoration: line-through;
  }
</style>
