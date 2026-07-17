<script lang="ts">
  import ChevronRight from '../icons/chevron-right.svelte';
  import House from '../icons/house.svelte';
  import Lock from '../icons/lock.svelte';
  import type { ImageDebugEntry } from '../runtime/requestContext';
  import formatHighlight from '../vendor/json-format-highlight/index.ts';
  import { highlightColors } from './utils';

  let { image }: { image: ImageDebugEntry } = $props();

  let expanded = $state(false);

  const format = $derived(String(image.params.format ?? ''));
  const dims = $derived.by(() => {
    const width = image.params.width;
    const height = image.params.height;
    if (width && height) {
      return `${width}×${height}`;
    }
    if (width) {
      return `${width}w`;
    }
    if (height) {
      return `${height}h`;
    }
    return 'original';
  });
  const paramsHtml = $derived(formatHighlight(image.params, highlightColors));
</script>

<div class="island-row" class:open={expanded}>
  <div class="island-item">
    <button class="island-header" type="button" onclick={() => (expanded = !expanded)}>
      <span class="chevron"><ChevronRight size={12} /></span>
      <span class="island-name">{image.filename}</span>
    </button>
    <span class="island-meta">
      {#if image.local}
        <span class="local-icon" title="Local image import"><House size={10} /></span>
      {/if}
      {#if image.kind === 'inline'}<span class="island-tag tag-cached">inline</span>{/if}
      {#if image.size}<span class="island-tag tag-size">{image.size}</span>{/if}
      {#if format}<span class="island-tag tag-fmt">{format}</span>{/if}
      <span class="island-size">{dims}</span>
      {#if image.kind !== 'inline'}
        <span class="lock-icon" title="The image src + size name are encrypted (authenticated AES-256) in the URL. Decoded params are shown only in dev mode.">
          <Lock size={10} />
        </span>
      {/if}
    </span>
  </div>
  <div class="image-detail">
    {#if image.url}
      <a class="image-preview" href={image.url} target="_blank" rel="noopener" title="Open image in a new tab">
        <img src={image.url} loading="lazy" alt={image.filename} />
      </a>
    {:else}
      <div class="image-nopreview">Preview omitted (over 1 MB)</div>
    {/if}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized JSON highlight output -->
    <pre class="island-props">{@html paramsHtml}</pre>
  </div>
</div>

<style>
  /* Shared row chrome (.island-row, .island-item, .island-header, .chevron,
     .island-name, .island-meta, .island-tag, .island-size, .lock-icon) lives in
     MochiDebugBar.svelte as a bounded :global block. Only image-specific rules
     are below. */
  .local-icon {
    display: inline-flex;
    align-items: center;
    color: #a3c4a8;
    cursor: help;
  }
  .tag-fmt {
    background: rgba(184, 163, 196, 0.16);
    color: #b8a3c4;
    text-transform: uppercase;
  }
  .tag-cached {
    background: rgba(122, 162, 138, 0.16);
    color: #8fbf9f;
  }
  .tag-size {
    background: rgba(163, 184, 196, 0.16);
    color: #a3c4c4;
  }
  .image-detail {
    display: none;
    background: #181b13;
    border: 1px solid #353930;
    border-top: 1px solid #2e3228;
    border-radius: 0 0 6px 6px;
    padding: 8px 10px;
    flex-direction: column;
    gap: 8px;
  }
  .island-row.open .image-detail {
    display: flex;
  }
  .image-preview {
    display: block;
    align-self: flex-start;
    line-height: 0;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid #353930;
    background: repeating-conic-gradient(#2a2e25 0% 25%, #222620 0% 50%) 50% / 16px 16px;
  }
  .image-preview img {
    display: block;
    max-width: 100%;
    max-height: 140px;
    width: auto;
    height: auto;
  }
  .image-nopreview {
    align-self: flex-start;
    color: #8e9488;
    font-size: 10px;
    font-style: italic;
  }
  .island-props {
    background: transparent;
    color: #e8e6dd;
    margin: 0;
    padding: 0;
    font-size: 10px;
    line-height: 1.5;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
