<script lang="ts">
  import CtxProbe from './CtxProbe.svelte';

  // Identifier-form $props() with a spread: the hydratable signal arrives as
  // context, never as a prop, so the spread below must stay clean.
  const props: { title?: string } = $props();
</script>

<span data-spread {...props}></span>
<CtxProbe />
