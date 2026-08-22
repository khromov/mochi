<script lang="ts">
  import type { MarkComponentProps } from '@portabletext/svelte';
  import type { Snippet } from 'svelte';

  // A decorator has no markDef, so `portableText.value` is undefined here.
  let { children }: { portableText: MarkComponentProps<'highlight'>; children: Snippet } = $props();
</script>

<mark>{@render children()}</mark>

<style>
  mark {
    background: var(--badge-warning-bg);
    color: var(--badge-warning-text);
    padding: 0.05rem 0.25rem;
    border-radius: var(--radius-sm);
  }
</style>
