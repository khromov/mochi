<script lang="ts">
  import type { MarkComponentProps } from '@portabletext/svelte';
  import type { Snippet } from 'svelte';
  import type { Footnote } from './blocks.ts';

  let { portableText, children }: { portableText: MarkComponentProps<Footnote, { footnotes: Footnote[] }>; children: Snippet } = $props();

  let { footnotes } = $derived(portableText.global.context);
  let number = $derived(footnotes.findIndex((note) => note._key === portableText.value._key) + 1);
</script>

<span id="src-{portableText.value._key}">{@render children()}<sup><a href="#note-{portableText.value._key}">{number}</a></sup></span>

<style>
  span {
    border-bottom: 1px dashed var(--accent);
  }

  sup a {
    color: var(--accent);
    font-family: var(--font-mono);
    text-decoration: none;
  }
</style>
