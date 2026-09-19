<script lang="ts">
  import VariantA from './VariantA.svelte';
  import VariantB from './VariantB.svelte';
  import Never from './Never.svelte';
  let { variant }: { variant: string } = $props();
</script>

<div data-deferred>
  {#if variant === 'a'}
    <VariantA />
  {:else}
    <VariantB />
  {/if}
  {#if variant === 'never'}
    <Never />
  {/if}
</div>

<style>
  [data-deferred] {
    padding: 1px;
  }
</style>
