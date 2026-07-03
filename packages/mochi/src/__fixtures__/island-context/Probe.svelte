<script lang="ts">
  // `isHydratable()` reads a Svelte context seeded at the island boundary, so
  // it's true anywhere inside a hydrated island subtree (not just the
  // directive-bearing tag) and false for plain SSR-only invocations.
  import { isHydratable } from 'mochi-framework';
  import Self from './Probe.svelte';

  let { nest = false }: { nest?: boolean } = $props();
  const hydratable = isHydratable();
</script>

<span data-hydratable={String(hydratable)}>probe</span>
{#if nest}<Self />{/if}
