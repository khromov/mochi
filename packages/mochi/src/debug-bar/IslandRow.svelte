<script lang="ts">
  import ChevronRight from '../icons/chevron-right.svelte';
  import Crosshair from '../icons/crosshair.svelte';
  import Lock from '../icons/lock.svelte';
  import type { IslandInfo } from './types';
  import { formatSize, highlightColors } from './utils';
  import { locateIsland } from './highlight';
  import formatHighlight from '../vendor/json-format-highlight/index.ts';

  let { island }: { island: IslandInfo } = $props();

  let expanded = $state(false);

  let propsDisplay = $derived.by((): { html: string } | { text: string } => {
    const raw = window.__mochi_debug?.islandProps?.[island.id] ?? island.rawProps;
    if (!raw) {
      return { text: '(no props)' };
    }
    try {
      const parsed = JSON.parse(raw);
      return { html: formatHighlight(parsed, highlightColors) };
    } catch {
      return { text: raw };
    }
  });

  function handleLocate(e: MouseEvent) {
    e.stopPropagation();
    locateIsland(island.id);
  }
</script>

<div class="island-row" class:open={expanded}>
  <div class="island-item">
    <button class="island-header" type="button" onclick={() => (expanded = !expanded)}>
      <span class="chevron"><ChevronRight size={12} /></span>
      <span class="island-name">{island.name}</span>
    </button>
    <span class="island-meta">
      <span
        class="island-tag"
        class:tag-eager={island.mode === 'mochi:hydrate'}
        class:tag-visible={island.mode === 'mochi:hydrate:visible'}
        class:tag-server={island.mode.startsWith('mochi:defer')}
      >
        {island.mode}
      </span>
      {#if island.type === 'server'}
        <span class="lock-icon" title="Props are encrypted (authenticated AES-256) in production. Decoded props are shown only in dev mode.">
          <Lock size={10} />
        </span>
      {/if}
      {#if island.propsRef}
        <span class="shared-badge" title={`Props deduplicated into shared <script id="${island.propsRef}"> — payload counted once on the wire.`}>
          shared &middot; {formatSize(island.propsSize)}
        </span>
      {:else}
        <span class="island-size">{formatSize(island.propsSize)}</span>
      {/if}
      <button class="locate-btn" type="button" title="Scroll to and highlight this island" aria-label="Locate island" onclick={handleLocate}>
        <Crosshair size={12} />
      </button>
    </span>
  </div>
  {#if 'html' in propsDisplay}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized JSON highlight output -->
    <pre class="island-props">{@html propsDisplay.html}</pre>
  {:else}
    <pre class="island-props">{propsDisplay.text}</pre>
  {/if}
</div>

<style>
  /* Shared row chrome (.island-row, .island-item, .island-header, .chevron,
     .island-name, .island-meta, .island-tag, .lock-icon) lives in
     MochiDebugBar.svelte as a bounded :global block. Only island-specific rules
     are below. */
  .tag-eager {
    background: rgba(167, 201, 168, 0.16);
    color: #a7c9a8;
  }
  .tag-visible {
    background: rgba(184, 163, 196, 0.16);
    color: #b8a3c4;
  }
  .tag-server {
    background: rgba(213, 185, 130, 0.16);
    color: #d5b982;
  }
  .shared-badge {
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 500;
    background: rgba(163, 184, 196, 0.18);
    color: #a3b8c4;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    cursor: help;
  }
  .locate-btn {
    background: none;
    border: 1px solid #2e3228;
    color: #8e9488;
    cursor: pointer;
    padding: 2px 5px;
    border-radius: 3px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    transition:
      color 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }
  .locate-btn:hover {
    color: #8ab79a;
    border-color: #8ab79a;
    background: rgba(138, 183, 154, 0.1);
  }
  .island-props {
    display: none;
    background: #181b13;
    color: #e8e6dd;
    border: 1px solid #353930;
    border-top: 1px solid #2e3228;
    border-radius: 0 0 6px 6px;
    margin: 0;
    padding: 8px 10px;
    font-size: 10px;
    line-height: 1.5;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .island-row.open .island-props {
    display: block;
  }
</style>
