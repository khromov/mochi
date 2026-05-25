<script lang="ts">
  import { onMount } from 'svelte';
  import DebugPanel from './DebugPanel.svelte';
  import { debugBarState } from './state.svelte';
  import { formatSize } from './utils';
  import ArrowUpRight from '../icons/arrow-up-right.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  type BundleInfo = {
    url: string;
    label: string;
    sizeBytes: number;
    kind: 'bootstrap' | 'island' | 'chunk';
  };

  let bundles: BundleInfo[] = $state([]);

  let totalSize = $derived(bundles.reduce((sum, b) => sum + b.sizeBytes, 0));
  let bootstrapBundles = $derived(bundles.filter((b) => b.kind === 'bootstrap'));
  let islandBundles = $derived(bundles.filter((b) => b.kind === 'island'));
  let chunkBundles = $derived(bundles.filter((b) => b.kind === 'chunk'));

  $effect(() => {
    debugBarState.totalBundleSize = totalSize;
  });

  const statsHref = `${window.__mochi_asset_prefix}/client/stats`;

  onMount(() => {
    bundles = (window.__mochi_debug?.bundles as BundleInfo[] | undefined) ?? [];
  });
</script>

<DebugPanel title="JS Bundles" color="#b8a3c4" {open} {onclose}>
  <div class="bundle-body">
    {#if bundles.length === 0}
      <div class="bundle-empty">No framework bundles on this page.</div>
    {:else}
      <div class="bundle-summary">
        <strong>{formatSize(totalSize)}</strong> total &middot; {bundles.length} bundle{bundles.length !== 1 ? 's' : ''}
      </div>

      {#if bootstrapBundles.length > 0}
        <div class="bundle-group-label">Runtime</div>
        {#each bootstrapBundles as bundle (bundle.url)}
          <div class="bundle-row">
            <span class="bundle-name">{bundle.label}</span>
            <span class="bundle-size">{formatSize(bundle.sizeBytes)}</span>
          </div>
        {/each}
      {/if}

      {#if islandBundles.length > 0}
        <div class="bundle-group-label">Islands</div>
        {#each islandBundles as bundle (bundle.url)}
          <div class="bundle-row">
            <span class="bundle-name">{bundle.label}</span>
            <span class="bundle-size">{formatSize(bundle.sizeBytes)}</span>
          </div>
        {/each}
      {/if}

      {#if chunkBundles.length > 0}
        <div class="bundle-group-label">Shared Chunks</div>
        {#each chunkBundles as bundle (bundle.url)}
          <div class="bundle-row">
            <span class="bundle-name">{bundle.label}</span>
            <span class="bundle-size">{formatSize(bundle.sizeBytes)}</span>
          </div>
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
    margin-bottom: 3px;
  }
  .bundle-row:last-child {
    margin-bottom: 0;
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
  .bundle-empty {
    color: #72786c;
    font-size: 11px;
    padding: 16px 10px;
    text-align: center;
    font-style: italic;
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
