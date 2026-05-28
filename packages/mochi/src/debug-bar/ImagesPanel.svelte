<script lang="ts">
  import { onMount } from 'svelte';
  import DebugPanel from './DebugPanel.svelte';
  import ImageRow from './ImageRow.svelte';
  import { debugBarState } from './state.svelte';
  import type { ImageDebugEntry } from '../requestContext';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let images: ImageDebugEntry[] = $state([]);

  onMount(() => {
    images = window.__mochi_debug?.images ?? [];
  });

  $effect(() => {
    debugBarState.imageCount = images.length;
  });
</script>

<DebugPanel title="Images" color="#d4b8c8" {open} {onclose}>
  <div class="image-body">
    {#if images.length === 0}
      <div class="image-empty">No resized images on this page.</div>
    {:else}
      <div class="image-summary">
        <strong>{images.length}</strong> image{images.length !== 1 ? 's' : ''} &middot; resized via <code>getResizedImage()</code>
      </div>
      {#each images as image (image.url)}
        <ImageRow {image} />
      {/each}
    {/if}
  </div>
</DebugPanel>

<style>
  .image-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .image-empty {
    color: #8e9488;
    font-size: 11px;
    padding: 4px 6px;
  }
  .image-summary {
    color: #bdc2b4;
    font-size: 10px;
    padding: 2px 6px 8px;
  }
  .image-summary code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #d4b8c8;
  }
</style>
