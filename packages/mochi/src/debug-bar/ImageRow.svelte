<script lang="ts">
  import ChevronRight from '../icons/chevron-right.svelte';
  import Lock from '../icons/lock.svelte';
  import type { ImageDebugEntry } from '../requestContext';
  import formatHighlight from '../vendor/json-format-highlight/index.ts';
  import { highlightColors } from './utils';

  let { image }: { image: ImageDebugEntry } = $props();

  let expanded = $state(false);

  const fmt = $derived(String(image.params.format ?? ''));
  const dims = $derived.by(() => {
    const w = image.params.width;
    const h = image.params.height;
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
      <span class="lock-icon" title="Image params are AES-256-GCM encrypted in production. Decoded params are shown only in dev mode.">
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
    {#if image.wire}
      <div class="wire">
        <div class="wire-head">
          <span class="wire-title">Wire format</span>
          <span class="wire-sub">binary, before AES-256-GCM</span>
        </div>
        <pre class="wire-bytes">{image.wire.headerHex}<span class="wire-tail"> + {image.wire.srcBytes} B utf-8 src</span></pre>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Shared row chrome (.island-row, .island-item, .island-header, .chevron,
     .island-name, .island-meta, .island-tag, .island-size, .lock-icon) lives in
     MochiDebugBar.svelte as a bounded :global block. Only image-specific rules
     are below. */
  .tag-fmt {
    background: rgba(184, 163, 196, 0.16);
    color: #b8a3c4;
    text-transform: uppercase;
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
  .wire {
    border-top: 1px solid #2e3228;
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .wire-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .wire-title {
    font-size: 10px;
    font-weight: 600;
    color: #b8a3c4;
  }
  .wire-sub {
    font-size: 9px;
    color: #8e9488;
  }
  .wire-bytes {
    margin: 0;
    padding: 0;
    font-size: 10px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
    color: #d4b8c8;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .wire-tail {
    color: #8e9488;
  }
</style>
