<script lang="ts">
  import { renderSVG } from 'uqr';

  let { url, size = 220 }: { url: string; size?: number } = $props();

  const svg = $derived(renderSVG(url, { border: 2 }));
</script>

<div class="qr" style="width: {size}px; max-width: 100%;" aria-label="QR code linking to {url}">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- generated SVG markup from uqr, not end-user input -->
  {@html svg}
</div>

<style>
  .qr {
    background: #fff;
    padding: 0.75rem;
    border-radius: var(--radius-sm);
    display: inline-block;
  }

  .qr :global(svg) {
    display: block;
    width: 100%;
    height: auto;
  }
</style>
