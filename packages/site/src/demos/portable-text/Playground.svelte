<script lang="ts">
  import { PortableText } from '@portabletext/svelte';
  import type { InputValue } from '@portabletext/svelte';
  import { isHydratable } from 'mochi-framework';
  import Badge from '../../components/Badge.svelte';
  import CalloutBlock from './CalloutBlock.svelte';
  import Highlight from './Highlight.svelte';

  let { source }: { source: string } = $props();

  const live = isHydratable();
  const uid = $props.id();

  // svelte-ignore state_referenced_locally
  let text = $state(source);
  let parsed = $derived.by(() => {
    try {
      return { value: JSON.parse(text) as InputValue, error: null };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  });
</script>

<div class="playground">
  <div class="head">
    <Badge kind={live ? 'success' : 'info'}>{live ? 'mochi:hydrate' : 'SSR only'}</Badge>
    <span class="note">{live ? 'edit the JSON — the output re-renders' : 'no JavaScript shipped — the field is read-only'}</span>
  </div>

  <label class="sr-only" for="pt-source-{uid}">Portable Text JSON</label>
  <textarea id="pt-source-{uid}" bind:value={text} readonly={!live} spellcheck="false" rows="12"></textarea>

  {#if parsed.error}
    <p class="error">{parsed.error}</p>
  {/if}

  <div class="output">
    <PortableText value={parsed.value ?? []} components={{ types: { callout: CalloutBlock }, marks: { highlight: Highlight } }} onMissingComponent={false} />
  </div>
</div>

<style>
  .playground {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .note {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  textarea {
    width: 100%;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    line-height: 1.5;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--code-bg);
    color: var(--code-text);
    resize: vertical;
  }

  textarea[readonly] {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .error {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--badge-danger-text);
  }

  .output {
    padding: 0.1rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 0.9rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }
</style>
