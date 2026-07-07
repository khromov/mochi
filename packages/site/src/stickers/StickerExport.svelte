<script lang="ts">
  import { toPng } from 'html-to-image';

  let { targetId }: { targetId: string } = $props();

  let busy = $state(false);
  let error = $state('');

  async function download() {
    const node = document.getElementById(targetId);
    if (!node) return;
    busy = true;
    error = '';
    try {
      // pixelRatio 3 → each 720px card renders at 2160px, a crisp print sheet.
      // The whole render happens once in the browser, so the grain and gradient
      // stay sharp and identical across every sticker (unlike the print path).
      // Explicit width/height: the sheet is wider than the viewport, and without
      // them html-to-image clips the overflowing right column.
      const dataUrl = await toPng(node, {
        pixelRatio: 3,
        cacheBust: true,
        width: node.scrollWidth,
        height: node.scrollHeight,
        backgroundColor: '#ffffff',
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'mochi-stickers.png';
      a.click();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="export">
  <button class="export-btn" onclick={download} disabled={busy}>
    {busy ? 'Generating…' : 'Download PNG'}
  </button>
  {#if error}
    <span class="export-error">Export failed: {error}</span>
  {/if}
</div>

<style>
  .export {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .export-btn {
    font-family: var(--font-sans, system-ui);
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--accent-text, #fff);
    background: var(--accent, #4a7c59);
    border: none;
    border-radius: var(--radius-md, 8px);
    padding: 0.55rem 1rem;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  .export-btn:hover:not(:disabled) {
    background: var(--accent-hover, #3d6b4a);
  }

  .export-btn:disabled {
    opacity: 0.65;
    cursor: default;
  }

  .export-error {
    font-size: 0.85rem;
    color: #b3261e;
  }
</style>
