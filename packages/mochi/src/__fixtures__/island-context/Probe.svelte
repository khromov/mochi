<script lang="ts">
  import type { Snippet } from 'svelte';
  import CtxProbe from './CtxProbe.svelte';

  // `isHydratable` is a plain user prop now — the framework injects no props
  // at all (the signal travels as Svelte context), so this must stay undefined
  // on every invocation (regression probe for the removed public prop).
  let { isHydratable, children }: { isHydratable?: boolean; children?: Snippet } = $props();
</script>

<span data-hydratable={String(isHydratable === true)}>probe</span>
<CtxProbe />
{@render children?.()}
