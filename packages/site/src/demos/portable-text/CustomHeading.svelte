<script lang="ts">
  import type { BlockComponentProps } from '@portabletext/svelte';
  import type { Snippet } from 'svelte';
  import LinkIcon from '@lucide/svelte/icons/link';

  let { portableText, children }: { portableText: BlockComponentProps; children: Snippet } = $props();

  let { indexInParent, global, value } = $derived(portableText);
  let previous = $derived(global.ptBlocks[indexInParent - 1] as { style?: string } | undefined);
  let precededByHeading = $derived(['h1', 'h2', 'h3', 'h4', 'h5'].includes(previous?.style ?? ''));
  let anchorId = $derived(`pt-${value._key}`);
</script>

<div class="heading" class:tight={precededByHeading} id={anchorId}>
  <a class="anchor" href="#{anchorId}"><span class="sr-only">Link to this heading</span><LinkIcon size={13} aria-hidden="true" /></a>
  {#if value.style === 'h2'}
    <h2>{@render children()}</h2>
  {:else}
    <h3>{@render children()}</h3>
  {/if}
  <span class="probe">indexInParent {indexInParent} · precededByHeading {String(precededByHeading)}</span>
</div>

<style>
  .heading {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    margin-top: 1.6rem;
  }

  /* The whole point of the demo: a heading right after another sits tighter. */
  .heading.tight {
    margin-top: 0.4rem;
  }

  .anchor {
    color: var(--text-subtle);
  }

  h2,
  h3 {
    margin: 0;
    font-family: var(--font-serif);
    font-weight: 500;
  }

  h2 {
    font-size: 1.3rem;
  }

  h3 {
    font-size: 1.05rem;
  }

  .probe {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-subtle);
    white-space: nowrap;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }

  @media (max-width: 560px) {
    .probe {
      display: none;
    }
  }
</style>
