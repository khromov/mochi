<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { BundleInfo } from '../requestContext';
  import ChevronRight from '../icons/chevron-right.svelte';
  import ArrowUpRight from '../icons/arrow-up-right.svelte';
  import DebugPanel from './DebugPanel.svelte';
  import { debugBarState } from './state.svelte';
  import { formatSize } from './utils';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let bundles: BundleInfo[] = $state([]);
  let expanded: Record<string, boolean> = $state({});

  let totalSize = $derived(bundles.reduce((sum, b) => sum + b.sizeBytes, 0));
  let bootstrapBundles = $derived(bundles.filter((b) => b.kind === 'bootstrap'));
  let islandBundles = $derived(bundles.filter((b) => b.kind === 'island'));
  let chunkBundles = $derived(bundles.filter((b) => b.kind === 'chunk'));

  $effect(() => {
    debugBarState.totalBundleSize = totalSize;
  });

  function toggleExpand(url: string) {
    expanded[url] = !expanded[url];
  }

  let selectedInput: string | null = $state(null);
  let copiedPath: string | null = $state(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  function selectInput(path: string) {
    if (selectedInput === path) {
      selectedInput = null;
      return;
    }
    selectedInput = path;
    navigator.clipboard?.writeText(path);
    clearTimeout(copiedTimer);
    copiedPath = path;
    copiedTimer = setTimeout(() => {
      copiedPath = null;
    }, 1200);
  }

  const statsHref = `${window.__mochi_asset_prefix}/client/stats`;

  onMount(() => {
    bundles = (window.__mochi_debug?.bundles as BundleInfo[] | undefined) ?? [];
  });

  onDestroy(() => {
    clearTimeout(copiedTimer);
  });
</script>

{#snippet bundleRow(bundle: BundleInfo)}
  {@const displaySize = bundle.effectiveSize ?? bundle.sizeBytes}
  {@const displayInputs = bundle.effectiveInputs ?? bundle.inputs}
  <div class="bundle-entry" class:open={expanded[bundle.url]}>
    <div class="bundle-row">
      <button class="bundle-header" type="button" onclick={() => toggleExpand(bundle.url)}>
        <span class="chevron"><ChevronRight size={12} /></span>
        <span class="bundle-name">{bundle.label}</span>
      </button>
      <span class="bundle-size">{formatSize(displaySize)}</span>
    </div>
    <div class="bundle-inputs">
      {#each displayInputs as input (input.path)}
        <button class="input-row" class:selected={selectedInput === input.path} type="button" onclick={() => selectInput(input.path)}>
          <span class="input-path">{input.path}</span>
          <span class="input-size">{formatSize(input.size)}</span>
          {#if copiedPath === input.path}
            <span class="copied-toast">Copied</span>
          {/if}
        </button>
      {/each}
      {#if displayInputs.length === 0 && bundle.kind === 'bootstrap'}
        <div class="bundle-note">Islands may pull in additional bundles not calculated here.</div>
      {/if}
    </div>
  </div>
{/snippet}

<DebugPanel title="JS Bundles" color="#b8a3c4" {open} {onclose}>
  <div class="bundle-body">
    {#if bundles.length === 0}
      <div class="bundle-empty">
        <div class="empty-celebration">
          <div class="empty-blob" class:animate={open}></div>
          <span class="empty-emoji">{'\u{1F973}'}</span>
        </div>
        <div class="empty-text">No framework bundles on this page!</div>
      </div>
    {:else}
      <div class="bundle-summary">
        <strong>{formatSize(totalSize)}</strong> total &middot; {bundles.length} bundle{bundles.length !== 1 ? 's' : ''}
      </div>

      {#if bootstrapBundles.length > 0}
        <div class="bundle-group-label">Runtime</div>
        {#each bootstrapBundles as bundle (bundle.url)}
          {@render bundleRow(bundle)}
        {/each}
      {/if}

      {#if islandBundles.length > 0}
        <div class="bundle-group-label">Islands</div>
        {#each islandBundles as bundle (bundle.url)}
          {@render bundleRow(bundle)}
        {/each}
      {/if}

      {#if chunkBundles.length > 0}
        <div class="bundle-group-label">Shared Chunks</div>
        {#each chunkBundles as bundle (bundle.url)}
          {@render bundleRow(bundle)}
        {/each}
      {/if}
    {/if}
    <a href={statsHref} target="_blank" rel="noopener" class="stats-link">
      Full bundle analysis <ArrowUpRight size={10} />
    </a>
  </div>
</DebugPanel>

<style>
  .bundle-summary {
    background: #272a22;
    color: #bdc2b4;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #353930;
    font-size: 11px;
    line-height: 1.6;
    margin-bottom: 6px;
  }
  .bundle-summary :global(strong) {
    color: #e8e6dd;
    font-weight: 700;
  }
  .bundle-group-label {
    color: #8c9286;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 8px 6px 4px;
    font-family: inherit;
  }
  .bundle-entry {
    margin-bottom: 3px;
  }
  .bundle-entry:last-child {
    margin-bottom: 0;
  }
  .bundle-row {
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
  .bundle-row:hover {
    background: #2d3128;
    border-color: #434836;
  }
  .bundle-entry.open .bundle-row {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    background: #2d3128;
    border-bottom-color: transparent;
  }
  .bundle-header {
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
  .bundle-header:hover .chevron {
    color: #b8a3c4;
  }
  .bundle-entry.open .chevron {
    transform: rotate(90deg);
    color: #b8a3c4;
  }
  .bundle-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .bundle-size {
    font-size: 10px;
    color: #b8a3c4;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    flex-shrink: 0;
  }
  .bundle-inputs {
    display: none;
    background: #181b13;
    border: 1px solid #353930;
    border-top: 1px solid #2e3228;
    border-radius: 0 0 6px 6px;
    padding: 6px 8px;
    max-height: 200px;
    overflow-y: auto;
  }
  .bundle-entry.open .bundle-inputs {
    display: block;
  }
  .input-row {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    padding: 2px 4px;
    font-size: 10px;
    line-height: 1.5;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
    border-radius: 3px;
    transition: background 120ms ease;
  }
  .input-row:hover {
    background: rgba(184, 163, 196, 0.06);
  }
  .input-row.selected {
    background: rgba(184, 163, 196, 0.14);
  }
  .input-row.selected .input-path {
    white-space: normal;
    word-break: break-all;
    color: #d4cce0;
  }
  .input-path {
    color: #a8ada0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    transition: color 120ms ease;
  }
  .input-size {
    color: #8c9286;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    flex-shrink: 0;
  }
  .copied-toast {
    position: absolute;
    top: 1px;
    right: 4px;
    font-size: 9px;
    font-weight: 600;
    color: #1c1f17;
    background: #b8a3c4;
    padding: 1px 6px;
    border-radius: 3px;
    pointer-events: none;
    animation: copied-fade 1.2s ease forwards;
  }
  @keyframes copied-fade {
    0% {
      opacity: 1;
      transform: translateY(0);
    }
    70% {
      opacity: 1;
      transform: translateY(-4px);
    }
    100% {
      opacity: 0;
      transform: translateY(-8px);
    }
  }
  .bundle-note {
    color: #72786c;
    font-size: 10px;
    font-style: italic;
    padding: 6px 4px;
  }
  .bundle-empty {
    padding: 20px 10px 16px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .empty-celebration {
    position: relative;
    width: 76px;
    height: 76px;
  }
  .empty-blob {
    position: absolute;
    inset: 0;
    background: rgba(138, 183, 154, 0.22);
    border-radius: 42% 58% 64% 36% / 47% 34% 66% 53%;
    animation: none;
  }
  .empty-blob.animate {
    animation:
      blob-morph 6s ease-in-out infinite,
      blob-rotate 12s linear infinite;
  }
  .empty-emoji {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 54px;
    line-height: 1;
    filter: saturate(0.85);
  }
  .empty-text {
    color: #a8ada0;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  @keyframes blob-morph {
    0%,
    100% {
      border-radius: 42% 58% 64% 36% / 47% 34% 66% 53%;
    }
    33% {
      border-radius: 58% 42% 36% 64% / 34% 66% 34% 66%;
    }
    66% {
      border-radius: 36% 64% 52% 48% / 66% 42% 58% 42%;
    }
  }
  @keyframes blob-rotate {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
  .stats-link {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #8c9286;
    font-size: 10px;
    text-decoration: none;
    padding: 8px 6px 2px;
    transition: color 120ms ease;
  }
  .stats-link:hover {
    color: #b8a3c4;
  }
</style>
