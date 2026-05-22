<script lang="ts">
  import { onMount } from 'svelte';
  import DebugPanel from './DebugPanel.svelte';
  import { debugBarState } from './state.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let warnings: string[] = $state([]);

  onMount(() => {
    // The dev shim in Mochi.ts seeds these on every dev request. Prod ships
    // no shim, but this panel is itself only loaded in dev.
    warnings = [...(window.__mochi_warnings ?? [])];
    debugBarState.warningCount = warnings.length;

    const origWarn = window.__mochi_warn;
    window.__mochi_warn = (msg: string) => {
      origWarn?.(msg);
      warnings = [...warnings, msg];
      debugBarState.warningCount = warnings.length;
    };
  });
</script>

<DebugPanel title="Warnings" color="#d5b982" {open} {onclose}>
  {#each warnings as msg, i (i)}
    <div class="warn-item">{msg}</div>
  {/each}
</DebugPanel>

<style>
  .warn-item {
    background: #2e3228;
    color: #f0eee5;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.5;
    margin-bottom: 4px;
    word-break: break-word;
    border: 1px solid #434836;
    border-left: 3px solid #d5b982;
  }
  .warn-item:last-child {
    margin-bottom: 0;
  }
</style>
