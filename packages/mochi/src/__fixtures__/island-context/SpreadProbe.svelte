<script lang="ts">
  import CtxProbe from './CtxProbe.svelte';

  // Identifier-form $props(): the seed pass rewrites this into a rest
  // destructure, so the spread below must not carry the transport prop.
  const props: { title?: string } = $props();
</script>

<span data-spread {...props}></span>
<CtxProbe />
