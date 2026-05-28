<script lang="ts">
  import ChevronRight from '../icons/chevron-right.svelte';
  import Lock from '../icons/lock.svelte';
  import type { ImageDebugEntry } from '../requestContext';
  import formatHighlight from '../vendor/json-format-highlight/index.ts';

  let { image }: { image: ImageDebugEntry } = $props();

  let expanded = $state(false);

  const highlightColors = {
    keyColor: '#b8d5be',
    numberColor: '#e9a89a',
    stringColor: '#d5b982',
    trueColor: '#a7c9a8',
    falseColor: '#a7c9a8',
    nullColor: '#72786c',
  };

  const fmt = $derived(String(image.params.fmt ?? ''));
  const dims = $derived.by(() => {
    const w = image.params.w;
    const h = image.params.h;
    if (w && h) {
      return `${w}×${h}`;
    }
    if (w) {
      return `${w}w`;
    }
    if (h) {
      return `${h}h`;
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
      {#if fmt}<span class="island-tag tag-fmt">{fmt}</span>{/if}
      <span class="island-size">{dims}</span>
      <span class="lock-icon" title="Image params are HMAC-signed in production to prevent tampering. Decoded params are shown only in dev mode.">
        <Lock size={10} />
      </span>
    </span>
  </div>
  <div class="image-detail">
    <a class="image-preview" href={image.url} target="_blank" rel="noopener" title="Open image in a new tab">
      <img src={image.url} loading="lazy" alt={image.filename} />
    </a>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized JSON highlight output -->
    <pre class="island-props">{@html paramsHtml}</pre>
  </div>
</div>

<style>
  .island-row {
    margin-bottom: 3px;
  }
  .island-row:last-child {
    margin-bottom: 0;
  }
  .island-item {
    background: #272a22;
    color: #e8e6dd;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid #353930;
    font-size: 11px;
    line-height: 1.5;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    transition:
      background 120ms ease,
      border-color 120ms ease;
  }
  .island-item:hover {
    background: #2d3128;
    border-color: #434836;
  }
  .island-row.open .island-item {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    background: #2d3128;
    border-bottom-color: transparent;
  }
  .island-header {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    padding: 0;
    cursor: pointer;
    text-align: left;
    flex: 1;
    min-width: 0;
  }
  .chevron {
    color: #8e9488;
    display: inline-flex;
    align-items: center;
    transition:
      transform 120ms ease,
      color 120ms ease;
  }
  .island-header:hover .chevron {
    color: #8ab79a;
  }
  .island-row.open .chevron {
    transform: rotate(90deg);
    color: #8ab79a;
  }
  .island-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .island-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    color: #a8ada0;
    flex-shrink: 0;
  }
  .island-tag {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 500;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.02em;
  }
  .tag-fmt {
    background: rgba(184, 163, 196, 0.16);
    color: #b8a3c4;
    text-transform: uppercase;
  }
  .island-size {
    font-size: 10px;
    color: #8e9488;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .lock-icon {
    display: inline-flex;
    align-items: center;
    color: #c4a3a8;
    cursor: help;
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
