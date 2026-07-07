<script lang="ts">
  import { onMount } from 'svelte';
  import DebugPanel from './DebugPanel.svelte';
  import X from '../icons/x.svelte';
  import type { DebugBarConfig } from '../requestContext';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let mochiVersion: string | null = $state(null);
  let svelteVersion: string | null = $state(null);
  let bunVersion: string | null = $state(null);
  let config: DebugBarConfig | null = $state(null);
  let query = $state('');

  onMount(() => {
    const info = window.__mochi_debug;
    if (info) {
      mochiVersion = info.mochiVersion ?? null;
      svelteVersion = info.svelteVersion ?? null;
      bunVersion = info.bunVersion ?? null;
      config = info.config ?? null;
    }
  });

  let versionRows = $derived(
    (
      [
        { key: 'Mochi', value: mochiVersion },
        { key: 'Svelte', value: svelteVersion },
        { key: 'Bun', value: bunVersion },
      ] as Array<{ key: string; value: string | null }>
    ).filter((r): r is { key: string; value: string } => r.value !== null),
  );

  type Row = { key: string; value: string; muted: boolean };

  function onOff(v: boolean): Row['value'] {
    return v ? 'on' : 'off';
  }

  let configRows = $derived.by<Row[]>(() => {
    if (!config) {
      return [];
    }
    const rows: Row[] = [
      { key: 'Mode', value: config.mode, muted: false },
      { key: 'Port', value: config.port !== undefined ? String(config.port) : '(default)', muted: config.port === undefined },
      ...(config.hostname ? [{ key: 'Hostname', value: config.hostname, muted: false }] : []),
      { key: 'Debug bar', value: onOff(config.debugBar), muted: !config.debugBar },
      { key: 'Live reload', value: onOff(config.liveReload), muted: !config.liveReload },
      { key: 'Warmup', value: onOff(config.warmup), muted: !config.warmup },
      { key: 'Compress island props', value: onOff(config.compressServerIslandProps), muted: !config.compressServerIslandProps },
      { key: 'Trailing slash', value: config.trailingSlash, muted: false },
      { key: 'Log level', value: config.logLevel, muted: false },
      ...(config.assetPrefix ? [{ key: 'Asset prefix', value: config.assetPrefix, muted: false }] : []),
      { key: 'Middleware', value: onOff(config.middleware), muted: !config.middleware },
      { key: 'CSRF', value: onOff(config.csrf), muted: !config.csrf },
      { key: 'Proxy', value: onOff(config.proxy), muted: !config.proxy },
      { key: 'Markdown', value: onOff(config.markdown), muted: !config.markdown },
      { key: 'Email', value: config.email, muted: config.email === 'log' },
      { key: 'Routes', value: String(config.routeCount), muted: false },
    ];
    return rows;
  });

  function matches(row: { key: string; value: string }, q: string): boolean {
    return row.key.toLowerCase().includes(q) || row.value.toLowerCase().includes(q);
  }

  let normalizedQuery = $derived(query.trim().toLowerCase());
  let filteredVersionRows = $derived(normalizedQuery ? versionRows.filter((r) => matches(r, normalizedQuery)) : versionRows);
  let filteredConfigRows = $derived(normalizedQuery ? configRows.filter((r) => matches(r, normalizedQuery)) : configRows);
  let noMatches = $derived(normalizedQuery !== '' && filteredVersionRows.length === 0 && filteredConfigRows.length === 0);
</script>

<DebugPanel title="Info" color="#9ab8c8" {open} {onclose}>
  <div class="info-body">
    {#if versionRows.length === 0 && configRows.length === 0}
      <div class="info-empty">No info available</div>
    {:else}
      <div class="info-search-wrap">
        <input class="info-search" type="text" placeholder="Filter by key or value…" bind:value={query} aria-label="Filter info" />
        {#if query}
          <button class="info-search-clear" type="button" onclick={() => (query = '')} aria-label="Clear filter"><X size={12} /></button>
        {/if}
      </div>

      {#if filteredVersionRows.length > 0}
        <div class="section-label">Versions</div>
        {#each filteredVersionRows as row (row.key)}
          <div class="info-item">
            <span class="info-key">{row.key}</span>
            <span class="info-val">{row.value}</span>
          </div>
        {/each}
      {/if}

      {#if filteredConfigRows.length > 0}
        <div class="section-label">Config</div>
        {#each filteredConfigRows as row (row.key)}
          <div class="info-item">
            <span class="info-key">{row.key}</span>
            <span class="info-val" class:muted={row.muted}>{row.value}</span>
          </div>
        {/each}
      {/if}

      {#if noMatches}
        <div class="info-empty">No matches for "{query.trim()}"</div>
      {/if}
    {/if}
  </div>
</DebugPanel>

<style>
  .info-search-wrap {
    position: relative;
    margin-bottom: 6px;
  }
  .info-search {
    width: 100%;
    box-sizing: border-box;
    background: #272a22;
    color: #e8e6dd;
    border: 1px solid #353930;
    border-radius: 6px;
    padding: 6px 28px 6px 10px;
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    line-height: 1.5;
    outline: none;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }
  .info-search::placeholder {
    color: #72786c;
    font-style: italic;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .info-search:focus {
    border-color: #9ab8c8;
    box-shadow: 0 0 0 1px rgba(154, 184, 200, 0.25);
  }
  .info-search-clear {
    position: absolute;
    top: 50%;
    right: 6px;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 2px;
    color: #72786c;
    cursor: pointer;
    border-radius: 4px;
    line-height: 0;
    transition:
      color 120ms ease,
      background 120ms ease;
  }
  .info-search-clear:hover {
    color: #9ab8c8;
    background: rgba(154, 184, 200, 0.12);
  }
  .info-empty {
    color: #72786c;
    font-size: 11px;
    padding: 16px 10px;
    text-align: center;
    font-style: italic;
  }
  .section-label {
    color: #9ab8c8;
    font-size: 10px;
    font-weight: 600;
    padding: 10px 6px 4px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-family: inherit;
  }
  .info-item {
    background: #272a22;
    color: #e8e6dd;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid #353930;
    font-size: 11px;
    line-height: 1.5;
    margin-bottom: 3px;
    display: flex;
    gap: 8px;
  }
  .info-key {
    color: #9aa094;
    flex-shrink: 0;
    min-width: 140px;
    font-size: 10px;
    letter-spacing: 0.06em;
    padding-top: 1px;
  }
  .info-val {
    color: #e8e6dd;
    word-break: break-all;
    font-weight: 500;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .info-val.muted {
    color: #8c9286;
    font-weight: 400;
    font-style: italic;
  }
</style>
