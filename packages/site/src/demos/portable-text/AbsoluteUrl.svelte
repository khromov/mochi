<script lang="ts">
  import type { MarkComponentProps } from '@portabletext/svelte';
  import type { Snippet } from 'svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';

  type AbsUrl = { url?: string; newWindow?: boolean };

  let { portableText, children }: { portableText: MarkComponentProps<AbsUrl>; children: Snippet } = $props();

  let { value } = $derived(portableText);
  let newWindow = $derived(value?.newWindow ?? false);
</script>

{#if value?.url}
  <a href={value.url} target={newWindow ? '_blank' : undefined} rel={newWindow ? 'noopener noreferrer' : undefined}
    >{@render children()}<ExternalLink size={12} aria-hidden="true" /></a
  >
{:else}
  {@render children()}
{/if}

<style>
  a {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    color: var(--accent);
  }
</style>
