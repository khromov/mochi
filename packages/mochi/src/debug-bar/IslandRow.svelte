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
    keyColor: '#7dd3fc',
    numberColor: '#fbbf24',
    stringColor: '#86efac',
    trueColor: '#c4b5fd',
    falseColor: '#c4b5fd',
    nullColor: '#94a3b8',
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
    background: #2a2a3e;
    color: #e2e8f0;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.5;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .island-row.open .island-item {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
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
    color: #64748b;
    display: inline-flex;
    align-items: center;
    transition: transform 150ms ease;
  }
  .island-row.open .chevron {
    transform: rotate(90deg);
  }
  .island-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .island-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    color: #94a3b8;
    flex-shrink: 0;
  }
  .island-tag {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 600;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .lock-icon {
    display: inline-flex;
    align-items: center;
    color: #c4b5fd;
    cursor: help;
  }
  .tag-eager {
    background: #065f46;
    color: #6ee7b7;
  }
  .tag-visible {
    background: #1e3a5f;
    color: #7dd3fc;
  }
  .tag-server {
    background: #4c1d95;
    color: #c4b5fd;
  }
  .island-size {
    font-size: 10px;
    color: #64748b;
  }
  .shared-badge {
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 600;
    background: #1e3a5f;
    color: #7dd3fc;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    cursor: help;
  }
  .locate-btn {
    background: none;
    border: 1px solid #444;
    color: #94a3b8;
    cursor: pointer;
    padding: 1px 5px;
    border-radius: 3px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
  }
  .locate-btn:hover {
    color: #fff;
    border-color: #22d3ee;
  }
  .island-props {
    display: none;
    background: #0f172a;
    color: #cbd5e1;
    border-radius: 0 0 6px 6px;
    margin: 0;
    padding: 8px 10px;
    font-size: 10px;
    line-height: 1.4;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .island-row.open .island-props {
    display: block;
  }
</style>
