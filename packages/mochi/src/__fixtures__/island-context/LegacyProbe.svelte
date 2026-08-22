<script>
  import CtxProbe from './CtxProbe.svelte';

  // Legacy mode (export let): the hydratable signal arrives as context, never
  // as a prop, so it can't surface in the $$restProps spread below.
  export let label = '';
</script>

<span data-legacy {...$$restProps}>{label}</span>
<CtxProbe />
