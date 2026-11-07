<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children?: Snippet } = $props();
</script>

<p data-marker="optout-child">optout child content</p>
{@render children?.()}
