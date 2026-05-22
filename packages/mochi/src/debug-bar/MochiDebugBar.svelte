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

  type Panel = 'warnings' | 'islands' | 'request' | null;
  let activePanel: Panel = $state(null);

  let hasDebugInfo = $state(false);
  let pageCacheEnabled = $state(false);

  function toggle(panel: Panel) {
    activePanel = activePanel === panel ? null : panel;
  }

  let barEl: HTMLElement;

  function handleDocumentClick(e: MouseEvent) {
    if (barEl && !barEl.contains(e.target as Node)) {
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
    document.addEventListener('click', handleDocumentClick);

    return () => {
      document.removeEventListener('click', handleDocumentClick);
    };
  });

  onDestroy(() => {
    cleanupHighlight();
  });
</script>

<div class="mochi-debug-bar-root" bind:this={barEl}>
  <WarningsPanel open={activePanel === 'warnings'} onclose={() => (activePanel = null)} />
  <IslandsPanel open={activePanel === 'islands'} onclose={() => (activePanel = null)} />
  <RequestPanel open={activePanel === 'request'} onclose={() => (activePanel = null)} />

  <div class="bar">
    <StatusDot />
    <span class="logo">{'\u{1F361}'} mochi</span>
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
</div>

<style>
  .mochi-debug-bar-root {
    all: initial;
    position: fixed;
    bottom: 12px;
    right: 12px;
    max-width: calc(100vw - 24px);
    z-index: 99999;
    font-family:
      'Public Sans',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      sans-serif;
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
    padding: 0.45em 0.85em 0.45em 0.7em;
    border-radius: 12px;
    box-shadow:
      0 10px 32px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 253, 240, 0.04) inset;
    border: 1px solid #2e3228;
    letter-spacing: 0.01em;
    white-space: nowrap;
    font-size: 1em;
  }
  .logo {
    font-family: 'Fraunces Variable', Georgia, 'Times New Roman', serif;
    font-variation-settings:
      'opsz' 14,
      'SOFT' 50;
    font-weight: 500;
    font-size: 1.05em;
    color: #e8e6dd;
    padding-right: 0.25em;
    display: inline-flex;
    align-items: baseline;
    gap: 0.35em;
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
