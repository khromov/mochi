<script lang="ts">
  import ChevronRight from '../icons/chevron-right.svelte';
  import Crosshair from '../icons/crosshair.svelte';
  import Lock from '../icons/lock.svelte';
  import type { IslandInfo } from './types';
  import { formatSize } from './utils';
  import { locateIsland } from './highlight';
  import formatHighlight from 'json-format-highlight';

  let { island }: { island: IslandInfo } = $props();

  let expanded = $state(false);

  const highlightColors = {
    keyColor: '#b8d5be',
    numberColor: '#e9a89a',
    stringColor: '#d5b982',
    trueColor: '#a7c9a8',
    falseColor: '#a7c9a8',
    nullColor: '#72786c',
  };

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
        <span class="lock-icon" title="Props are HMAC-signed in production to prevent tampering. Unencrypted props are shown only in dev mode.">
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
  .island-row {
    margin-bottom: 3px;
  }
  .island-row:last-child {
    margin-bottom: 0;
  }
  .island-item {
    background: #252820;
    color: #e8e6dd;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.5;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    transition: background 120ms ease;
  }
  .island-item:hover {
    background: #2a2e25;
  }
  .island-row.open .island-item {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    background: #2a2e25;
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
  .lock-icon {
    display: inline-flex;
    align-items: center;
    color: #c7e0cd;
    cursor: help;
  }
  .tag-eager {
    background: rgba(138, 183, 154, 0.18);
    color: #a7c9a8;
  }
  .tag-visible {
    background: rgba(199, 224, 205, 0.12);
    color: #b8d5be;
  }
  .tag-server {
    background: rgba(213, 185, 130, 0.15);
    color: #d5b982;
  }
  .island-size {
    font-size: 10px;
    color: #8e9488;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .shared-badge {
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 500;
    background: rgba(138, 183, 154, 0.15);
    color: #a7c9a8;
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
    background: #171914;
    color: #e8e6dd;
    border-radius: 0 0 6px 6px;
    margin: 0;
    padding: 8px 10px;
    font-size: 10px;
    line-height: 1.5;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    border-top: 1px solid #2e3228;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .island-row.open .island-props {
    display: block;
  }
</style>
