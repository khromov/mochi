<script lang="ts">
  type Source = { label: string; lang: string; html: string; styleHtml?: string };
  let { sources }: { sources: Source[] } = $props();

  let selected = $state(0);
  const current = $derived(sources[selected]);
</script>

<div class="code-viewer">
  <div class="cv-tabs" role="tablist">
    {#each sources as s, i (i)}
      <button type="button" role="tab" aria-selected={selected === i} class="cv-tab" class:active={selected === i} onclick={() => (selected = i)}>
        {s.label}
      </button>
    {/each}
  </div>
  {#if current}
    <div class="cv-panel">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html current.html}
    </div>
    {#if current.styleHtml}
      <details class="cv-style">
        <summary>Styles</summary>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html current.styleHtml}
      </details>
    {/if}
  {/if}
</div>

<style>
  .code-viewer {
    margin-top: 1rem;
    max-width: 100%;
    /* Persist the viewer across cross-document view transitions instead of
       letting the root snapshot cross-fade it — otherwise it blinks on nav.
       view-transition-names must be unique per document, so this assumes at
       most one CodeViewer per page (DemoPage renders exactly one); a second
       instance would silently break the page's whole transition. */
    view-transition-name: code-viewer;
  }

  .cv-tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.4rem;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .cv-tab {
    flex: 0 0 auto;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.85rem;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .cv-tab:hover {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }

  .cv-tab.active {
    background: var(--accent);
    color: var(--surface);
    font-weight: 600;
  }

  .cv-tab:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* The global rules in shell.html handle padding, radius, and background.
     Zero the prose-flow bottom margin and tighten the font for the demo viewer. */
  .cv-panel :global(pre),
  .cv-style :global(pre) {
    margin: 0;
    font-size: 0.82rem;
  }

  /* When a styles section follows the main panel, fuse them visually into one
     continuous code box: square the seam between them and let the styles
     section carry the rounded bottom corners. */
  .code-viewer:has(.cv-style) .cv-panel :global(pre) {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .cv-style :global(pre) {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  .cv-style > summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 1rem;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--code-muted, var(--code-text));
    background: var(--code-bg);
    user-select: none;
  }

  .cv-style:not([open]) > summary {
    border-bottom-left-radius: var(--radius-md);
    border-bottom-right-radius: var(--radius-md);
  }

  .cv-style[open] > summary {
    border-bottom: 1px solid color-mix(in srgb, var(--code-text) 12%, transparent);
  }

  .cv-style > summary::-webkit-details-marker {
    display: none;
  }

  .cv-style > summary::before {
    content: '▸';
    font-size: 0.7rem;
    line-height: 1;
    opacity: 0.7;
    transition: transform 0.12s ease;
  }

  .cv-style[open] > summary::before {
    transform: rotate(90deg);
  }

  .cv-style > summary:hover {
    color: var(--code-text);
  }

  .cv-style > summary:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
