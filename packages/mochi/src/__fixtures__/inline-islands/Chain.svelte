<script lang="ts">
  import Child from './Child.svelte';
  import CondChild from './CondChild.svelte';
  import VisibleChild from './VisibleChild.svelte';
  import AlsoHydrateChild from './AlsoHydrateChild.svelte';
  let { cond = false }: { cond?: boolean } = $props();
  // The fallback children below are consumed by the island wrapper as loading UI, never passed to the components.
</script>

<p data-marker="chain">chain top</p>
<Child mochi:defer><span data-marker="child-fallback">loading child</span></Child>
{#if cond}
  <CondChild mochi:defer />
{/if}
<VisibleChild mochi:defer:visible />
<AlsoHydrateChild mochi:defer mochi:hydrate label="hydrate me" />
