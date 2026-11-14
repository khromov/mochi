<script lang="ts">
  let {
    html,
    caption,
    copyable = true,
    class: className = '',
  }: {
    html: string;
    caption?: string;
    copyable?: boolean;
    class?: string;
  } = $props();

  const rendered = $derived(copyable ? html : html.replace(/<button type="button" class="code-copy"[\s\S]*?<\/button>/, ''));
</script>

<figure class="code {className}">
  {#if caption}
    <figcaption>{caption}</figcaption>
  {/if}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted server-side highlighter output -->
  {@html rendered}
</figure>

<style>
  .code {
    margin: 0;
    min-width: 0;
    background: var(--code-bg);
    border: 1px solid var(--code-chrome-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  figcaption {
    padding: 0.45rem 0.9rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--code-muted);
    background: var(--code-chrome-bg);
    border-bottom: 1px solid var(--code-chrome-border);
  }

  .code :global(pre) {
    margin: 0;
    padding: 1rem 1.1rem;
    background: transparent;
    color: var(--code-text);
    font-family: var(--font-mono);
    font-size: 0.82rem;
    line-height: 1.6;
    overflow-x: auto;
    border: 0;
    border-radius: 0;
  }
</style>
