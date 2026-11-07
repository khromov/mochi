<script lang="ts">
  import { toPng } from 'html-to-image';
  import { dangoDataUri } from './dango';

  let { targetId }: { targetId: string } = $props();

  let busy = $state<string | null>(null);
  let error = $state('');

  function save(href: string, filename: string) {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
  }

  async function exportSticker(filename: string, withText: boolean) {
    const node = document.getElementById(targetId);
    if (!node) {
      return;
    }
    busy = filename;
    error = '';
    try {
      // pixelRatio 3 renders the 8rem noise tile at its native 384px; no backgroundColor keeps the corners transparent.
      const dataUrl = await toPng(node, {
        pixelRatio: 3,
        cacheBust: true,
        skipFonts: !withText,
        filter: (child) => withText || !(child instanceof HTMLElement && child.classList.contains('sticker-inner')),
      });
      save(dataUrl, filename);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
    }
  }
</script>

<div class="export">
  <button class="export-btn" onclick={() => exportSticker('mochi-sticker.png', true)} disabled={busy !== null}>
    {busy === 'mochi-sticker.png' ? 'Generating…' : 'Download sticker'}
  </button>

  <button class="export-btn" onclick={() => exportSticker('mochi-sticker-background.png', false)} disabled={busy !== null}>
    {busy === 'mochi-sticker-background.png' ? 'Generating…' : 'Download background'}
  </button>

  <button class="export-btn" onclick={() => save(dangoDataUri, 'mochi-dango.png')} disabled={busy !== null}>Download icon</button>

  {#if error}
    <span class="export-error">Export failed: {error}</span>
  {/if}
</div>

<style>
  .export {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    font-family: var(--font-sans, system-ui);
  }

  .export-btn {
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
