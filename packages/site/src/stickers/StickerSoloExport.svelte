<script lang="ts">
  import { toPng } from 'html-to-image';
  import { dangoDataUri } from './dango';

  let { targetId }: { targetId: string } = $props();

  let busy = $state<string | null>(null);
  let error = $state('');
  let white = $state(false);

  function save(href: string, name: string) {
    const a = document.createElement('a');
    a.href = href;
    a.download = white ? `${name}-white.png` : `${name}.png`;
    a.click();
  }

  async function exportSticker(name: string, withText: boolean) {
    const node = document.getElementById(targetId);
    if (!node) {
      return;
    }
    busy = name;
    error = '';
    try {
      // pixelRatio 3 renders the 8rem noise tile at its native 384px; without a backgroundColor the corners stay transparent.
      const dataUrl = await toPng(node, {
        pixelRatio: 3,
        cacheBust: true,
        skipFonts: !withText,
        backgroundColor: white ? '#ffffff' : undefined,
        filter: (child) => withText || !(child instanceof HTMLElement && child.classList.contains('sticker-inner')),
      });
      save(dataUrl, name);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
    }
  }

  async function downloadIcon() {
    if (!white) {
      save(dangoDataUri, 'mochi-dango');
      return;
    }
    const img = new Image();
    img.src = dangoDataUri;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    save(canvas.toDataURL('image/png'), 'mochi-dango');
  }
</script>

<div class="export">
  <button class="export-btn" onclick={() => exportSticker('mochi-sticker', true)} disabled={busy !== null}>
    {busy === 'mochi-sticker' ? 'Generating…' : 'Download sticker'}
  </button>

  <button class="export-btn" onclick={() => exportSticker('mochi-sticker-background', false)} disabled={busy !== null}>
    {busy === 'mochi-sticker-background' ? 'Generating…' : 'Download background'}
  </button>

  <button class="export-btn" onclick={downloadIcon} disabled={busy !== null}>Download icon</button>

  <label class="bg-toggle">
    <input type="checkbox" bind:checked={white} />
    White background
  </label>

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

  .bg-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
    color: var(--text-muted, #4a5751);
    cursor: pointer;
  }

  .export-error {
    font-size: 0.85rem;
    color: #b3261e;
  }
</style>
