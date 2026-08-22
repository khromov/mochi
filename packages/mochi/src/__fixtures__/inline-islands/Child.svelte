<script lang="ts">
  import type { Snippet } from 'svelte';
  import GrandChild from './GrandChild.svelte';
  let { children }: { children?: Snippet } = $props();
</script>

<p data-marker="child">child content</p>
<GrandChild mochi:defer />
{@render children?.()}
