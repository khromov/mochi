<script>
  import CtxProbe from './CtxProbe.svelte';

  // Legacy mode (export let): the seed declares the transport prop, which
  // keeps it out of the $$restProps spread below.
  export let label = '';
</script>

<span data-legacy {...$$restProps}>{label}</span>
<CtxProbe />
