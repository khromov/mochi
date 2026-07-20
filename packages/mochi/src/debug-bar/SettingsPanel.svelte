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

  // Mirrors each button's palette in MochiDebugBar.svelte so rows map visually to the bar.
  const PANEL_COLORS: Record<ConfigurablePanel, { bg: string; fg: string; border: string }> = {
    info: { bg: '#243038', fg: '#b8cdd4', border: '#455560' },
    request: { bg: '#2c343a', fg: '#b8cad4', border: '#4a5560' },
    islands: { bg: '#2a3a2f', fg: '#c7e0cd', border: '#4a6354' },
    images: { bg: '#382a32', fg: '#d4b8c8', border: '#5a4050' },
    warnings: { bg: '#3a3120', fg: '#f0d398', border: '#6a5530' },
    bundles: { bg: '#2e2a38', fg: '#c4b8d4', border: '#4a4060' },
    cache: { bg: '#223833', fg: '#a7d0c4', border: '#3f5f54' },
  };
</script>

<DebugPanel title="Panels" color="#8c9286" {open} {onclose}>
  <div class="settings-body">
    {#each CONFIGURABLE_PANELS as panel (panel)}
      {@const visible = !hiddenPanels.includes(panel)}
      {@const colors = PANEL_COLORS[panel]}
      <label class="panel-row" style:background={colors.bg} style:color={colors.fg} style:border-color={colors.border} style:accent-color={colors.fg}>
        <input type="checkbox" checked={visible} disabled={visible && !canToggle(hiddenPanels, panel)} onchange={() => ontoggle(panel)} />
        {PANEL_LABELS[panel]}
      </label>
    {/each}
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
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid;
    font-size: 11px;
    line-height: 1.5;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
    transition: filter 120ms ease;
  }
  .panel-row:hover {
    filter: brightness(1.18);
  }
  .panel-row:has(input:disabled) {
    cursor: default;
  }
  .panel-row input {
    cursor: pointer;
    margin: 0;
  }
  .panel-row input:disabled {
    cursor: default;
    opacity: 0.5;
  }
</style>
