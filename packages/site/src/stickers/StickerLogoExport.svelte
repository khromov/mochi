<script lang="ts">
  import { toPng } from 'html-to-image';

  let { targetId, wordmarkId }: { targetId: string; wordmarkId: string } = $props();

  let busy = $state(false);
  let error = $state('');

  async function download(id: string, filename: string, fullCanvas: boolean) {
    const node = document.getElementById(id);
    if (!node) {
      return;
    }
    busy = true;
    error = '';
    try {
      // The white backdrop is for on-page viewing only; overriding it on the
      // clone keeps the exported PNG's alpha channel. The wordmark has no
      // background of its own and exports at its natural size.
      const dataUrl = await toPng(node, {
        pixelRatio: 1,
        cacheBust: true,
        ...(fullCanvas ? { width: 800, height: 800, style: { backgroundColor: 'transparent' } } : {}),
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.click();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="export">
  <button class="export-btn" onclick={() => download(targetId, 'mochi-logo.png', true)} disabled={busy}>
    {busy ? 'Generating…' : 'Download PNG'}
  </button>

  <button class="export-btn" onclick={() => download(wordmarkId, 'mochi-wordmark.png', false)} disabled={busy}>
    {busy ? 'Generating…' : 'Download wordmark PNG'}
  </button>

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

  .export-error {
    font-size: 0.85rem;
    color: #b3261e;
  }
</style>
