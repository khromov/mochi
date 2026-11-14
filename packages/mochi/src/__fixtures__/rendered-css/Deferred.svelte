<script lang="ts">
  import DeferredA from './DeferredA.svelte';
  import DeferredB from './DeferredB.svelte';
  import DeferredNever from './DeferredNever.svelte';
  let { variant }: { variant: string } = $props();
</script>

<div data-deferred>
  {#if variant === 'a'}
    <DeferredA />
  {:else}
    <DeferredB />
  {/if}
  {#if variant === 'never'}
    <DeferredNever />
  {/if}
</div>

<style>
  [data-deferred] {
    padding: 1px;
  }
</style>
