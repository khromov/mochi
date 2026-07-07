<script lang="ts">
  import { toPng } from 'html-to-image';

  let { targetId, gridId }: { targetId: string; gridId: string } = $props();

  const presets = [
    { label: '2 × 2', cols: 2, rows: 2 },
    { label: '3 × 3', cols: 3, rows: 3 },
    { label: '4 × 4', cols: 4, rows: 4 },
    { label: '5 × 5', cols: 5, rows: 5 },
    { label: '6 × 6', cols: 6, rows: 6 },
  ];

  let selected = $state(1); // 3 × 3
  let busy = $state(false);
  let error = $state('');

  // The grid is server-rendered outside this island, so drive it through the
  // DOM: set --cols/--rows and clone/trim the (identical) sticker cells to
  // match cols × rows. Cloning is safe because no card carries per-card state.
  function applyGrid(cols: number, rows: number) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.style.setProperty('--cols', String(cols));
    grid.style.setProperty('--rows', String(rows));
    const count = cols * rows;
    const template = grid.firstElementChild;
    if (!template) return;
    while (grid.children.length < count) grid.appendChild(template.cloneNode(true));
    while (grid.children.length > count) grid.lastElementChild!.remove();
  }

  function onSelect(e: Event) {
    selected = Number((e.currentTarget as HTMLSelectElement).value);
    const { cols, rows } = presets[selected];
    applyGrid(cols, rows);
  }

  async function download() {
    const node = document.getElementById(targetId);
    if (!node) return;
    busy = true;
    error = '';
    try {
      // Fixed sheet size → the export stays ~6600px wide at any grid density.
      // Rendering the DOM once (WYSIWYG) keeps the grain and gradient sharp and
      // identical across every sticker. Explicit width/height stops the wider-
      // than-viewport sheet from having its right column clipped.
      const { cols, rows } = presets[selected];
      const dataUrl = await toPng(node, {
        pixelRatio: 3,
        cacheBust: true,
        width: node.scrollWidth,
        height: node.scrollHeight,
        backgroundColor: '#ffffff',
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `mochi-stickers-${cols}x${rows}.png`;
      a.click();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="export">
  <label class="grid-picker">
    <span>Grid</span>
    <select onchange={onSelect}>
      {#each presets as p, i (p.label)}
        <option value={i} selected={i === selected}>{p.label}</option>
      {/each}
    </select>
  </label>

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
    gap: 1rem;
    margin-bottom: 1.5rem;
    font-family: var(--font-sans, system-ui);
  }

  .grid-picker {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--text-muted, #4a5751);
  }

  .grid-picker select {
    font: inherit;
    color: var(--text, #1f2a24);
    background: var(--surface, #fff);
    border: 1px solid var(--border, #e8e4d8);
    border-radius: var(--radius-md, 8px);
    padding: 0.4rem 0.6rem;
    cursor: pointer;
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
