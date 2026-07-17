<script lang="ts">
  import type { Snippet } from 'svelte';
  import CtxProbe from './CtxProbe.svelte';

  // `isHydratable` is auto-injected as a prop on hydratable children;
  // plain SSR-only invocations leave it undefined.
  let { isHydratable, children }: { isHydratable?: boolean; children?: Snippet } = $props();
</script>

<span data-hydratable={String(isHydratable === true)}>probe</span>
<CtxProbe />
{@render children?.()}
