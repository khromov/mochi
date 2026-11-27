<script lang="ts">
  import { toPng } from 'html-to-image';

  let { targetId }: { targetId: string } = $props();

  let busy = $state(false);
  let error = $state('');
  let white = $state(false);

  async function download() {
    const node = document.getElementById(targetId);
    if (!node) {
      return;
    }
    busy = true;
    error = '';
    try {
      // pixelRatio 3 renders the 8rem noise tile at its native 384px; without a backgroundColor the corners stay transparent.
      const dataUrl = await toPng(node, { pixelRatio: 3, cacheBust: true, backgroundColor: white ? '#ffffff' : undefined });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = white ? 'mochi-sticker-oblong-white.png' : 'mochi-sticker-oblong.png';
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
    {busy ? 'Generating…' : 'Download sticker'}
  </button>

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
