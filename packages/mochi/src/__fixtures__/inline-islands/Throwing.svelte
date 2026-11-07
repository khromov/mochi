<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children?: Snippet } = $props();
  const boom = (): string => {
    throw new Error('inline-fixture: ssr throw');
  };
</script>

<p data-marker="throwing">{boom()}</p>
{@render children?.()}
