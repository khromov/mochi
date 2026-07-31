<script lang="ts">
  import type { ListComponentProps } from '@portabletext/svelte';
  import type { Snippet } from 'svelte';

  let { children }: { portableText: ListComponentProps; children: Snippet } = $props();
</script>

<ul>{@render children()}</ul>

<style>
  ul {
    list-style: none;
    margin: 0.5rem 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
</style>
