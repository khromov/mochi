<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import ArrowUpRight from '../icons/arrow-up-right.svelte';
  import StatusDot from './StatusDot.svelte';
  import RequestPanel from './RequestPanel.svelte';
  import IslandsPanel from './IslandsPanel.svelte';
  import WarningsPanel from './WarningsPanel.svelte';
  import { cleanupHighlight } from './highlight';
  import { debugBarState } from './state.svelte';
  import { getPropsWarnLevel } from './utils';

  const STORAGE_KEY = 'mochi-debug-bar-collapsed';

  type Panel = 'warnings' | 'islands' | 'request' | null;
  let activePanel: Panel = $state(null);

  let hasDebugInfo = $state(false);
  let pageCacheEnabled = $state(false);
  let collapsed = $state(false);

  function toggle(panel: Panel) {
    activePanel = activePanel === panel ? null : panel;
  }

  function collapse() {
    collapsed = true;
    activePanel = null;
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* storage blocked */
    }
  }

  function expand() {
    collapsed = false;
    try {
      localStorage.setItem(STORAGE_KEY, '0');
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

  // The debug bar mounts client-only via mount() and only runs in dev mode,
  // where Mochi.ts unconditionally seeds window.__mochi_asset_prefix.
  const statsHref = `${window.__mochi_asset_prefix}/client/stats`;
  const pageCacheHref = '/__mochi/admin/page-cache';

  onMount(() => {
    hasDebugInfo = !!window.__mochi_debug;
    pageCacheEnabled = !!window.__mochi_debug?.pageCacheEnabled;
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
  {#if collapsed}
    <button class="collapsed-toggle" onclick={expand} type="button" aria-label="Expand Mochi debug bar" title="Expand Mochi debug bar">
      <StatusDot />
    </button>
  {:else}
    <WarningsPanel open={activePanel === 'warnings'} onclose={() => (activePanel = null)} />
    <IslandsPanel open={activePanel === 'islands'} onclose={() => (activePanel = null)} />
    <RequestPanel open={activePanel === 'request'} onclose={() => (activePanel = null)} />

    <div class="bar">
      <button class="brand-toggle" onclick={collapse} type="button" aria-label="Collapse Mochi debug bar" title="Collapse">
        <StatusDot />
        <span class="logo">{'\u{1F361}'} mochi</span>
      </button>
      {#if hasDebugInfo}
        <button class="btn request-btn" onclick={() => toggle('request')}>Request</button>
      {/if}
      <button class="btn island-btn" class:warn-yellow={warnLevel === 'yellow'} class:warn-red={warnLevel === 'red'} onclick={() => toggle('islands')}>
        Islands <span class="badge" class:badge-yellow={warnLevel === 'yellow'} class:badge-red={warnLevel === 'red'}>{debugBarState.islandCount}</span>
      </button>
      {#if debugBarState.warningCount > 0}
        <button class="btn warn-btn" onclick={() => toggle('warnings')}>
          Warnings <span class="badge">{debugBarState.warningCount}</span>
        </button>
      {/if}
      {#if pageCacheEnabled}
        <a href={pageCacheHref} target="_blank" rel="noopener" class="btn stats-btn">
          Cache <ArrowUpRight size={12} />
        </a>
      {/if}
      <a href={statsHref} target="_blank" rel="noopener" class="btn stats-btn">
        Bundles <ArrowUpRight size={12} />
      </a>
    </div>
  {/if}
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
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 0.55em;
    background: #1f221c;
    color: #e8e6dd;
    padding: 0.4em 0.85em 0.4em 0.55em;
    border-radius: 12px;
    box-shadow:
      0 10px 32px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 253, 240, 0.04) inset;
    border: 1px solid #2e3228;
    letter-spacing: 0.01em;
    white-space: nowrap;
    font-size: 1em;
  }
  .brand-toggle {
    background: transparent;
    border: none;
    padding: 0.2em 0.45em 0.2em 0.4em;
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
      opacity 120ms ease;
  }
  .brand-toggle:hover {
    background: #2a2e25;
  }
  .brand-toggle:focus-visible {
    outline: 1px solid #8ab79a;
    outline-offset: 1px;
  }
  .logo {
    font-weight: 600;
    font-size: 1em;
    color: #e8e6dd;
    letter-spacing: 0.02em;
    display: inline-flex;
    align-items: baseline;
    gap: 0.35em;
  }
  .collapsed-toggle {
    background: #1f221c;
    border: 1px solid #2e3228;
    border-radius: 999px;
    padding: 0.55em;
    margin: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow:
      0 6px 18px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 253, 240, 0.04) inset;
    transition:
      transform 120ms ease,
      background 120ms ease,
      border-color 120ms ease;
    font: inherit;
    font-size: 1em;
  }
  .collapsed-toggle:hover {
    background: #252820;
    border-color: #434836;
    transform: scale(1.08);
  }
  .collapsed-toggle:focus-visible {
    outline: 1px solid #8ab79a;
    outline-offset: 2px;
  }
  .btn {
    color: #c7e0cd;
    background: #2a3a2f;
    padding: 0.3em 0.75em;
    border-radius: 6px;
    text-decoration: none;
    font-size: 0.88em;
    font-weight: 500;
    letter-spacing: 0.05em;
    border: 1px solid transparent;
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
    color: #e8e6dd;
  }
  .warn-btn {
    background: #2f281a;
    color: #d5b982;
  }
  .warn-btn:hover {
    background: #3a3120;
    color: #e8c79a;
  }
  .island-btn {
    background: #2a3a2f;
    color: #c7e0cd;
  }
  .island-btn:hover {
    background: #34463a;
    color: #e8e6dd;
  }
  .island-btn.warn-yellow {
    background: #2f281a;
    color: #d5b982;
  }
  .island-btn.warn-yellow:hover {
    background: #3a3120;
  }
  .island-btn.warn-red {
    background: #351f1a;
    color: #e9a89a;
  }
  .island-btn.warn-red:hover {
    background: #432821;
  }
  .request-btn {
    background: #24281f;
    color: #b5baa9;
  }
  .request-btn:hover {
    background: #2e3228;
    color: #e8e6dd;
  }
  .stats-btn {
    background: transparent;
    color: #8e9488;
    border-color: #2e3228;
  }
  .stats-btn:hover {
    color: #c7e0cd;
    border-color: #434836;
    background: #24281f;
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
    background: rgba(138, 183, 154, 0.18);
    color: #c7e0cd;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: 0;
  }
  .warn-btn .badge {
    background: rgba(213, 185, 130, 0.18);
    color: #d5b982;
  }
  .badge-yellow {
    background: rgba(213, 185, 130, 0.2);
    color: #d5b982;
  }
  .badge-red {
    background: rgba(233, 168, 154, 0.2);
    color: #e9a89a;
  }
</style>
