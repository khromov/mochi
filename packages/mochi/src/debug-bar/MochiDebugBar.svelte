<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import StatusDot from './StatusDot.svelte';
  import RequestPanel from './RequestPanel.svelte';
  import IslandsPanel from './IslandsPanel.svelte';
  import WarningsPanel from './WarningsPanel.svelte';
  import BundlesPanel from './BundlesPanel.svelte';
  import InfoPanel from './InfoPanel.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import Settings from '../icons/settings.svelte';
  import { cleanupHighlight } from './highlight';
  import { debugBarState } from './state.svelte';
  import { getPropsWarnLevel, formatSize } from './utils';
  import { HIDDEN_PANELS_KEY, parseHiddenPanels, type ConfigurablePanel } from './panelSettings';

  const STORAGE_KEY = 'mochi:debug:collapsed';

  type Panel = 'warnings' | 'islands' | 'request' | 'bundles' | 'info' | 'settings' | null;
  let activePanel: Panel = $state(null);

  let hasDebugInfo = $state(false);
  let collapsed = $state(false);

  function safeGetItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  let hiddenPanels: ConfigurablePanel[] = $state(parseHiddenPanels(safeGetItem(HIDDEN_PANELS_KEY)));

  $effect(() => {
    try {
      localStorage.setItem(HIDDEN_PANELS_KEY, JSON.stringify(hiddenPanels));
    } catch {
      /* storage blocked */
    }
  });

  // The last-visible-panel invariant is enforced by SettingsPanel disabling the
  // checkbox (via canToggle) — a disabled input never fires onchange.
  function togglePanelVisibility(panel: ConfigurablePanel) {
    if (hiddenPanels.includes(panel)) {
      hiddenPanels = hiddenPanels.filter((p) => p !== panel);
    } else {
      hiddenPanels = [...hiddenPanels, panel];
      if (activePanel === panel) {
        activePanel = null;
      }
    }
  }

  function toggle(panel: Panel) {
    activePanel = activePanel === panel ? null : panel;
  }

  function toggleCollapsed() {
    collapsed = !collapsed;
    if (collapsed) {
      activePanel = null;
    }
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage blocked */
    }
  }

  let rootEl: HTMLElement;

  function handleDocumentClick(e: MouseEvent) {
    if (rootEl && !rootEl.contains(e.target as Node)) {
      activePanel = null;
    }
  }

  let warnLevel = $derived(getPropsWarnLevel(debugBarState.totalPropsSize));

  let bundleSizeLabel = $derived(debugBarState.displayBundleSize > 0 ? formatSize(debugBarState.displayBundleSize) : '0');
  let noJs = $derived(debugBarState.totalBundleSize === 0);
  let bundleFiltered = $derived(debugBarState.bundleFiltered);

  onMount(() => {
    hasDebugInfo = !!window.__mochi_debug;
    try {
      collapsed = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      /* storage blocked */
    }
    document.addEventListener('click', handleDocumentClick);

    return () => {
      document.removeEventListener('click', handleDocumentClick);
    };
  });

  onDestroy(() => {
    cleanupHighlight();
  });
</script>

<div class="mochi-debug-bar-root" bind:this={rootEl}>
  <WarningsPanel open={activePanel === 'warnings'} onclose={() => (activePanel = null)} />
  <IslandsPanel open={activePanel === 'islands'} onclose={() => (activePanel = null)} />
  <BundlesPanel open={activePanel === 'bundles'} onclose={() => (activePanel = null)} />
  <RequestPanel open={activePanel === 'request'} onclose={() => (activePanel = null)} />
  <InfoPanel open={activePanel === 'info'} onclose={() => (activePanel = null)} />
  <SettingsPanel open={activePanel === 'settings'} onclose={() => (activePanel = null)} {hiddenPanels} ontoggle={togglePanelVisibility} />

  <div class="bar" class:is-collapsed={collapsed}>
    <button
      class="brand-toggle"
      onclick={toggleCollapsed}
      type="button"
      aria-label={collapsed ? 'Expand debug bar' : 'Collapse debug bar'}
      title={collapsed ? 'Expand debug bar' : 'Collapse debug bar'}
    >
      <StatusDot />
      <span class="logo">{'\u{1F361}'} mochi</span>
    </button>
    <div class="bar-actions" aria-hidden={collapsed}>
      {#if hasDebugInfo && !hiddenPanels.includes('info')}
        <button class="btn info-btn" onclick={() => toggle('info')} tabindex={collapsed ? -1 : 0}>Info</button>
      {/if}
      {#if hasDebugInfo && !hiddenPanels.includes('request')}
        <button class="btn request-btn" onclick={() => toggle('request')} tabindex={collapsed ? -1 : 0}>Request</button>
      {/if}
      {#if !hiddenPanels.includes('islands')}
        <button
          class="btn island-btn"
          class:warn-yellow={warnLevel === 'yellow'}
          class:warn-red={warnLevel === 'red'}
          onclick={() => toggle('islands')}
          tabindex={collapsed ? -1 : 0}
        >
          Islands <span class="badge" class:badge-yellow={warnLevel === 'yellow'} class:badge-red={warnLevel === 'red'}>{debugBarState.islandCount}</span>
        </button>
      {/if}
      {#if debugBarState.warningCount > 0 && !hiddenPanels.includes('warnings')}
        <button class="btn warn-btn" onclick={() => toggle('warnings')} tabindex={collapsed ? -1 : 0}>
          Warnings <span class="badge">{debugBarState.warningCount}</span>
        </button>
      {/if}
      {#if !hiddenPanels.includes('bundles')}
        <button class="btn bundles-btn" class:no-js={noJs} onclick={() => toggle('bundles')} tabindex={collapsed ? -1 : 0}>
          JS <span class="bundle-badge" class:sparkle={noJs}>{bundleSizeLabel}</span>
          {#if bundleFiltered}<span class="filter-dot"></span>{/if}
        </button>
      {/if}
      <button class="btn settings-btn" onclick={() => toggle('settings')} tabindex={collapsed ? -1 : 0} aria-label="Configure panels" title="Configure panels">
        <Settings size={12} />
      </button>
    </div>
  </div>
</div>

<style>
  .mochi-debug-bar-root {
    all: initial;
    position: fixed;
    bottom: 12px;
    right: 12px;
    max-width: calc(100vw - 24px);
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    /* Root font-size scales with viewport width so the whole bar shrinks
       together (everything else is sized in em). */
    font-size: clamp(9px, 2.6vw, 12px);
  }
  .bar {
    display: inline-flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 0.55em;
    background: #1f221c;
    color: #e8e6dd;
    padding: 0.4em 0.55em;
    height: 3em;
    box-sizing: border-box;
    border-radius: 12px;
    box-shadow:
      0 10px 32px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 253, 240, 0.04) inset;
    border: 1px solid #434836;
    letter-spacing: 0.01em;
    white-space: nowrap;
    font-size: 1em;
    transition:
      gap 220ms ease,
      border-radius 220ms ease,
      padding 220ms ease;
  }
  .bar.is-collapsed {
    gap: 0;
    border-radius: 999px;
    padding: 0;
    cursor: pointer;
  }
  .brand-toggle {
    background: transparent;
    border: 1px solid transparent;
    padding: 0.3em 0.55em 0.3em 0.4em;
    margin: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    color: #e8e6dd;
    font: inherit;
    border-radius: 6px;
    transition:
      background 120ms ease,
      gap 220ms ease,
      padding 220ms ease,
      border-color 120ms ease;
  }
  .bar:not(.is-collapsed) .brand-toggle {
    cursor:
      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><circle cx='12' cy='12' r='9' fill='%231f221c' stroke='%23e8e6dd' stroke-width='1.5' opacity='0.95'/><line x1='8.5' y1='12' x2='15.5' y2='12' stroke='%23e8e6dd' stroke-width='2' stroke-linecap='round'/></svg>")
        12 12,
      pointer;
  }
  .brand-toggle:hover {
    background: #2a2e25;
    border-color: #5a604d;
  }
  .brand-toggle:focus-visible {
    outline: 1px solid #8ab79a;
    outline-offset: 1px;
  }
  .is-collapsed .brand-toggle {
    gap: 0;
    padding: 1.14em;
    border-radius: 999px;
  }
  .is-collapsed .brand-toggle:hover {
    border-color: transparent;
  }
  .logo {
    font-weight: 600;
    font-size: 1em;
    color: #e8e6dd;
    letter-spacing: 0.02em;
    display: inline-flex;
    align-items: baseline;
    gap: 0.35em;
    max-width: 8em;
    line-height: 1.2;
    overflow: hidden;
    opacity: 1;
    transition:
      max-width 240ms ease,
      opacity 180ms ease,
      line-height 240ms ease;
  }
  .is-collapsed .logo {
    max-width: 0;
    opacity: 0;
    line-height: 0;
  }
  .bar-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.55em;
    max-width: 60em;
    overflow: hidden;
    opacity: 1;
    transition:
      max-width 260ms ease,
      opacity 180ms ease;
  }
  .is-collapsed .bar-actions {
    max-width: 0;
    opacity: 0;
    pointer-events: none;
  }
  .btn {
    color: #e8e6dd;
    background: #2a3a2f;
    padding: 0.3em 0.75em;
    border-radius: 6px;
    text-decoration: none;
    font-size: 0.88em;
    font-weight: 500;
    letter-spacing: 0.05em;
    border: 1px solid #4a5040;
    cursor: pointer;
    white-space: nowrap;
    flex: 0 0 auto;
    font-family: inherit;
    transition:
      background 120ms ease,
      color 120ms ease,
      border-color 120ms ease;
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
  }
  .btn:hover {
    background: #34463a;
    color: #ffffff;
    border-color: #8ab79a;
  }
  .warn-btn {
    background: #3a3120;
    color: #f0d398;
    border-color: #6a5530;
  }
  .warn-btn:hover {
    background: #45381f;
    color: #fdde9d;
    border-color: #d5b982;
  }
  .island-btn {
    background: #2a3a2f;
    color: #c7e0cd;
    border-color: #4a6354;
  }
  .island-btn:hover {
    background: #34463a;
    color: #e8e6dd;
    border-color: #8ab79a;
  }
  .island-btn.warn-yellow {
    background: #3a3120;
    color: #f0d398;
    border-color: #6a5530;
  }
  .island-btn.warn-yellow:hover {
    background: #45381f;
    border-color: #d5b982;
  }
  .island-btn.warn-red {
    background: #432821;
    color: #f4b6a7;
    border-color: #7a3a2a;
  }
  .island-btn.warn-red:hover {
    background: #4f2f27;
    border-color: #e9a89a;
  }
  .request-btn {
    background: #2c343a;
    color: #b8cad4;
    border-color: #4a5560;
  }
  .request-btn:hover {
    background: #353f47;
    color: #d4e0e8;
    border-color: #6a7a86;
  }
  .info-btn {
    background: #243038;
    color: #b8cdd4;
    border-color: #455560;
  }
  .info-btn:hover {
    background: #2d3b44;
    color: #d4e4ec;
    border-color: #7a96a4;
  }
  .bundles-btn {
    position: relative;
    background: #2e2a38;
    color: #c4b8d4;
    border-color: #4a4060;
  }
  .bundles-btn:hover {
    background: #383248;
    color: #e0d8ee;
    border-color: #b8a3c4;
  }
  .settings-btn {
    padding: 0.3em 0.45em;
    background: #23261f;
    color: #8c9286;
    border-color: #3d4137;
  }
  .settings-btn:hover {
    background: #2a2e25;
    color: #c7e0cd;
    border-color: #8ab79a;
  }
  .filter-dot {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #e85454;
    pointer-events: none;
  }
  .bundle-badge {
    border-radius: 999px;
    min-width: 1.4em;
    height: 1.4em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.82em;
    font-weight: 600;
    padding: 0 0.45em;
    background: rgba(184, 163, 196, 0.28);
    color: #e0d8ee;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: 0;
  }
  .bundles-btn.no-js {
    background: #1f2a20;
    color: #a8c9a8;
    border-color: #3a5040;
  }
  .bundles-btn.no-js:hover {
    background: #263228;
    color: #c8e8c8;
    border-color: #8ab79a;
  }
  .bundle-badge.sparkle {
    position: relative;
    overflow: visible;
    background: rgba(138, 183, 154, 0.28);
    color: #c8e8c8;
  }
  .bundle-badge.sparkle::after {
    content: '✦';
    position: absolute;
    top: -3px;
    right: -2px;
    font-size: 0.9em;
    color: #ffffff;
    animation: sparkle-pulse 2s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes sparkle-pulse {
    0%,
    100% {
      opacity: 0;
      transform: scale(0.5) rotate(0deg);
    }
    20% {
      opacity: 1;
      transform: scale(1.2) rotate(72deg);
    }
    50% {
      opacity: 0.6;
      transform: scale(0.8) rotate(144deg);
    }
    70% {
      opacity: 0;
      transform: scale(0.4) rotate(216deg);
    }
  }
  .badge {
    border-radius: 999px;
    min-width: 1.4em;
    height: 1.4em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.82em;
    font-weight: 600;
    padding: 0 0.45em;
    background: rgba(138, 183, 154, 0.28);
    color: #e8f0e0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: 0;
  }
  .warn-btn .badge {
    background: rgba(213, 185, 130, 0.3);
    color: #fdde9d;
  }
  .badge-yellow {
    background: rgba(213, 185, 130, 0.3);
    color: #fdde9d;
  }
  .badge-red {
    background: rgba(233, 168, 154, 0.3);
    color: #f4b6a7;
  }
</style>
