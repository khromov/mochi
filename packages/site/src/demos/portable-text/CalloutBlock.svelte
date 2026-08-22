<script lang="ts">
  import type { CustomBlockComponentProps } from '@portabletext/svelte';
  import Info from '@lucide/svelte/icons/info';

  type Callout = { tone?: string; text?: string };

  let { portableText }: { portableText: CustomBlockComponentProps<Callout> } = $props();

  let { value, isInline } = $derived(portableText);
</script>

{#if isInline}
  <span class="pt-callout inline"><Info size={13} aria-hidden="true" />{value.text}</span>
{:else}
  <aside class="pt-callout">
    <Info size={15} aria-hidden="true" />
    <span>{value.text}</span>
    {#if value.tone}
      <span class="tone">{value.tone}</span>
    {/if}
  </aside>
{/if}

<style>
  .pt-callout {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
  }

  aside.pt-callout {
    margin: 0.75rem 0;
    padding: 0.55rem 0.8rem;
    border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  .inline {
    display: inline-flex;
    padding: 0.05rem 0.4rem;
    vertical-align: baseline;
  }

  .tone {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    opacity: 0.7;
  }
</style>
