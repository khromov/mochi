<script lang="ts">
  import { ElementSize, useResizeObserver, IsInViewport, activeElement, IsFocusWithin } from 'runed';
  import Badge from '../../components/Badge.svelte';

  let box = $state<HTMLElement>();
  const size = new ElementSize(() => box);

  let resizes = $state(0);
  useResizeObserver(
    () => box,
    () => resizes++,
  );

  let scroller = $state<HTMLElement>();
  let target = $state<HTMLElement>();
  const inViewport = new IsInViewport(() => target, { root: () => scroller ?? null });

  let form = $state<HTMLFormElement>();
  const focusWithin = new IsFocusWithin(() => form);
</script>

<div class="grid">
  <div class="panel">
    <div class="head">
      <h3>ElementSize + useResizeObserver</h3>
      <span class="hint">drag the corner of the box</span>
    </div>
    <textarea bind:this={box} class="resizable" readonly>Drag my bottom-right corner ↘</textarea>
    <div class="readout">
      <code>{Math.round(size.width)} × {Math.round(size.height)}</code>
      <span class="meta">{resizes} resize event{resizes === 1 ? '' : 's'}</span>
    </div>
  </div>

  <div class="panel">
    <div class="head">
      <h3>IsInViewport</h3>
      <span class="hint">scroll the target in and out</span>
    </div>
    <div bind:this={scroller} class="scroller">
      <div class="spacer">scroll down ↓</div>
      <div bind:this={target} class="target" class:visible={inViewport.current}>
        {inViewport.current ? 'In viewport' : 'Out of viewport'}
      </div>
      <div class="spacer">↑ scroll up</div>
    </div>
    {#if inViewport.current}
      <Badge kind="success">visible</Badge>
    {:else}
      <Badge kind="default">hidden</Badge>
    {/if}
  </div>

  <div class="panel">
    <div class="head">
      <h3>activeElement + IsFocusWithin</h3>
      <span class="hint">tab through the fields</span>
    </div>
    <form bind:this={form} class="fields" class:lit={focusWithin.current}>
      <input type="text" placeholder="First" />
      <input type="text" placeholder="Second" />
      <button type="button">Button</button>
    </form>
    <div class="readout">
      <span class="meta">focused: <code>{activeElement.current?.localName ?? 'none'}</code></span>
      {#if focusWithin.current}
        <Badge kind="info">focus within</Badge>
      {/if}
    </div>
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .head h3 {
    font-size: 0.95rem;
    font-weight: 700;
    margin: 0;
    color: var(--text);
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-subtle);
  }

  .resizable {
    resize: both;
    min-width: 120px;
    min-height: 60px;
    width: 100%;
    padding: 0.5rem;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-muted);
    font: inherit;
    font-size: 0.85rem;
  }

  .scroller {
    height: 120px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }

  .spacer {
    height: 100px;
    display: grid;
    place-items: center;
    color: var(--text-subtle);
    font-size: 0.8rem;
  }

  .target {
    margin: 0.5rem;
    padding: 0.75rem;
    border-radius: var(--radius-sm);
    background: var(--surface-muted);
    color: var(--text-muted);
    text-align: center;
    font-size: 0.85rem;
    transition:
      background 0.2s ease,
      color 0.2s ease;
  }

  .target.visible {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition: box-shadow 0.15s ease;
  }

  .fields.lit {
    box-shadow: var(--focus-ring);
  }

  .fields input {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    outline: none;
  }

  .fields input:focus {
    border-color: var(--accent);
  }

  .fields button {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .readout {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    font-family: var(--font-mono);
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .meta {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
</style>
