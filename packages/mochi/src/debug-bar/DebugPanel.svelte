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
    background: #1a1a2e;
    border: 1px solid #333;
    border-radius: 8px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
    padding: 8px;
    opacity: 0;
    pointer-events: none;
    transform: translateY(4px);
    transition:
      opacity 150ms ease,
      transform 150ms ease;
  }
  .panel.open {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px 8px;
  }
  .panel-title {
    font-weight: 700;
    font-size: 11px;
    color: var(--panel-title-color);
  }
  .close-btn {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
  }
  .close-btn:hover {
    color: #fff;
  }
</style>
