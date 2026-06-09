<script lang="ts">
  import DebugPanel from './DebugPanel.svelte';
  import { CONFIGURABLE_PANELS, PANEL_LABELS, canToggle, type ConfigurablePanel } from './panelSettings';

  let {
    open,
    onclose,
    hiddenPanels,
    ontoggle,
  }: {
    open: boolean;
    onclose: () => void;
    hiddenPanels: ConfigurablePanel[];
    ontoggle: (panel: ConfigurablePanel) => void;
  } = $props();
</script>

<DebugPanel title="Panels" color="#8c9286" {open} {onclose}>
  <div class="settings-body">
    {#each CONFIGURABLE_PANELS as panel (panel)}
      {@const visible = !hiddenPanels.includes(panel)}
      <label class="panel-row">
        <input type="checkbox" checked={visible} disabled={visible && !canToggle(hiddenPanels, panel)} onchange={() => ontoggle(panel)} />
        {PANEL_LABELS[panel]}
      </label>
    {/each}
    <div class="settings-hint">At least one panel stays enabled.</div>
  </div>
</DebugPanel>

<style>
  .settings-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .panel-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #272a22;
    color: #e8e6dd;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid #353930;
    font-size: 11px;
    line-height: 1.5;
    cursor: pointer;
    user-select: none;
    transition:
      background 120ms ease,
      border-color 120ms ease;
  }
  .panel-row:hover {
    background: #2d3128;
    border-color: #434836;
  }
  .panel-row:has(input:disabled) {
    cursor: default;
  }
  .panel-row input {
    accent-color: #8ab79a;
    cursor: pointer;
    margin: 0;
  }
  .panel-row input:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .settings-hint {
    color: #72786c;
    font-size: 10px;
    font-style: italic;
    padding: 6px 4px 2px;
  }
</style>
