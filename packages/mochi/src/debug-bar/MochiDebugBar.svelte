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
    font-family: monospace, system-ui, sans-serif;
    /* Root font-size scales with viewport width so the whole bar shrinks
       together (everything else is sized in em). */
    font-size: clamp(9px, 2.6vw, 12px);
  }
  .bar {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 0.7em;
    background: #000;
    color: #fff;
    padding: 0.5em 1em;
    border-radius: 0.7em;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
    border: 1px solid #333;
    letter-spacing: 0.02em;
    white-space: nowrap;
    font-size: 1em;
  }
  .logo {
    font-weight: 700;
    opacity: 0.85;
  }
  .btn {
    color: #000;
    background: #fff;
    padding: 0.25em 0.85em;
    border-radius: 0.45em;
    text-decoration: none;
    font-size: 0.92em;
    font-weight: 600;
    letter-spacing: 0.04em;
    border: none;
    cursor: pointer;
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .warn-btn {
    background: #fbbf24;
    color: #78350f;
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
  }
  .island-btn {
    background: #22d3ee;
    color: #083344;
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    transition:
      background 150ms ease,
      color 150ms ease;
  }
  .island-btn.warn-yellow {
    background: #fbbf24;
    color: #78350f;
  }
  .island-btn.warn-red {
    background: #ef4444;
    color: #fff;
  }
  .request-btn {
    background: #a78bfa;
    color: #1e1b4b;
    display: inline-flex;
    align-items: center;
  }
  .stats-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
  }
  .badge {
    border-radius: 999px;
    min-width: 1.5em;
    height: 1.5em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.83em;
    font-weight: 700;
    padding: 0 0.4em;
    background: #083344;
    color: #22d3ee;
  }
  .warn-btn .badge {
    background: #78350f;
    color: #fbbf24;
  }
  .badge-yellow {
    background: #78350f;
    color: #fbbf24;
  }
  .badge-red {
    background: #7f1d1d;
    color: #fca5a5;
  }
</style>
