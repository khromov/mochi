<script lang="ts">
  import type { Snippet } from 'svelte';
  import X from '../icons/x.svelte';

  let {
    open,
    onclose,
    title,
    color,
    titleExtra,
    children,
  }: {
    open: boolean;
    onclose: () => void;
    title: string;
    color: string;
    titleExtra?: Snippet;
    children: Snippet;
  } = $props();
</script>

<div class="panel" class:open>
  <div class="panel-header">
    <div class="panel-title" style:--panel-title-color={color}>
      {title}{#if titleExtra}{@render titleExtra()}{/if}
    </div>
    <button class="close-btn" onclick={onclose} aria-label="Close"><X size={12} /></button>
  </div>
  {@render children()}
</div>

<style>
  .panel {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    width: min(420px, calc(100vw - 24px));
    box-sizing: border-box;
    max-height: 400px;
    overflow-y: auto;
    background: #1f221c;
    border: 1px solid #2e3228;
    border-radius: 10px;
    box-shadow:
      0 12px 36px rgba(0, 0, 0, 0.45),
      0 0 0 1px rgba(255, 253, 240, 0.03) inset;
    padding: 8px;
    opacity: 0;
    pointer-events: none;
    transform: translateY(4px);
    transition:
      opacity 120ms ease,
      transform 120ms ease;
    font-family:
      'Public Sans',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      sans-serif;
  }
  .panel.open {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
  .panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 4px 6px 10px;
    border-bottom: 1px solid rgba(46, 50, 40, 0.6);
    margin-bottom: 6px;
  }
  .panel-title {
    font-family: 'Fraunces Variable', Georgia, 'Times New Roman', serif;
    font-variation-settings:
      'opsz' 14,
      'SOFT' 50;
    font-weight: 500;
    font-size: 13px;
    color: var(--panel-title-color);
    font-variant-caps: all-small-caps;
    letter-spacing: 0.06em;
  }
  .close-btn {
    background: none;
    border: none;
    color: #72786c;
    cursor: pointer;
    padding: 2px 4px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    border-radius: 4px;
    transition:
      color 120ms ease,
      background 120ms ease;
  }
  .close-btn:hover {
    color: #8ab79a;
    background: rgba(138, 183, 154, 0.12);
  }
</style>
