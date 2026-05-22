<script lang="ts">
  import { onMount } from 'svelte';
  import Info from '../icons/info.svelte';
  import { formatSize } from './utils.js';
  import DebugPanel from './DebugPanel.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let debugInfo: {
    route: string;
    pathname: string;
    params: Record<string, string>;
  } | null = $state(null);

  let htmlDecodedSize: number | null = $state(null);
  let htmlEncodedSize: number | null = $state(null);

  let headers: Array<[string, string]> = $state([]);
  let expanded: Record<number, boolean> = $state({});

  let requestCookies: Array<[string, string]> = $state([]);
  let varyOnCookies: Set<string> = $state(new Set());

  onMount(() => {
    const info = window.__mochi_debug;
    if (info) {
      debugInfo = { route: info.route, pathname: info.pathname, params: info.params };
      if (info.headers) {
        headers = info.headers;
      }
      if (info.requestCookies) {
        requestCookies = info.requestCookies;
      }
      if (info.varyOnCookies) {
        varyOnCookies = new Set(info.varyOnCookies);
      }
    }

    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav && nav.decodedBodySize > 0) {
      htmlDecodedSize = nav.decodedBodySize;
      htmlEncodedSize = nav.encodedBodySize;
    }
  });

  let rows = $derived.by(() => {
    if (!debugInfo) {
      return [];
    }
    const paramKeys = Object.keys(debugInfo.params);
    return [
      { key: 'Route', value: debugInfo.route, muted: false },
      { key: 'Pathname', value: debugInfo.pathname, muted: false },
      {
        key: 'Params',
        value: paramKeys.length ? paramKeys.map((k) => `${k}=${debugInfo!.params[k]}`).join(', ') : '(none)',
        muted: paramKeys.length === 0,
      },
    ];
  });

  let isGzipped = $derived(htmlEncodedSize !== null && htmlEncodedSize > 0 && htmlEncodedSize !== htmlDecodedSize);

  let htmlSizeLabel = $derived.by(() => {
    if (htmlDecodedSize === null) {
      return null;
    }
    if (isGzipped) {
      return `${formatSize(htmlDecodedSize)} (${formatSize(htmlEncodedSize!)} over wire)`;
    }
    const estimate = formatSize(Math.round(htmlDecodedSize * 0.3));
    return `${formatSize(htmlDecodedSize)} (~${estimate} gzipped)`;
  });

  let gzipDisabledHint = $derived.by(() => {
    if (htmlDecodedSize === null || isGzipped) {
      return null;
    }
    return 'Estimated at ~30% of the uncompressed size. gzip is disabled in dev (enabled in prod). Keep in mind that dev also outputs a lot of extra debug HTML, so check sizes in production for an accurate picture.';
  });

  let sortedRequestCookies = $derived(
    [...requestCookies].sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase())).map(([name, value]) => ({ name, value, varies: varyOnCookies.has(name) })),
  );
  let variesCount = $derived(sortedRequestCookies.filter((c) => c.varies).length);

  let setCookies = $derived(headers.map(([name, value], idx) => ({ name, value, idx })).filter((row) => row.name.toLowerCase() === 'set-cookie'));

  let otherHeaders = $derived.by(() => {
    const skip = new Set(['set-cookie', 'content-length']);
    return headers.filter(([name]) => !skip.has(name.toLowerCase())).sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
  });

  function cookieName(raw: string): string {
    const eq = raw.indexOf('=');
    return eq >= 0 ? raw.slice(0, eq) : raw;
  }

  function toggleCookie(i: number) {
    expanded[i] = !expanded[i];
  }
</script>

<DebugPanel title="Request" color="#8ab79a" {open} {onclose}>
  {#snippet titleExtra()}
    {#if htmlSizeLabel}<span class="panel-title-meta"
        ><span class="panel-title-sep">·</span>{htmlSizeLabel}{#if gzipDisabledHint}<span class="gzip-info" title={gzipDisabledHint} aria-label={gzipDisabledHint}
            ><Info size={11} /></span
          >{/if}</span
      >{/if}
  {/snippet}

  <div class="request-body">
    {#each rows as row (row.key)}
      <div class="request-item">
        <span class="request-key">{row.key}</span>
        <span class="request-val" class:muted={row.muted}>{row.value}</span>
      </div>
    {/each}

    {#if headers.length > 0}
      {#if setCookies.length > 0}
        <div class="section-label">Set-Cookie</div>
        {#each setCookies as row (row.idx)}
          <button class="header-item header-row" onclick={() => toggleCookie(row.idx)}>
            <span class="header-key">{cookieName(row.value)}</span>
            <span class="header-val">
              {expanded[row.idx] ? row.value : `${row.value.slice(0, 60)}${row.value.length > 60 ? '…' : ''}`}
            </span>
          </button>
        {/each}
      {/if}

      {#if otherHeaders.length > 0}
        <div class="section-label">Headers</div>
        {#each otherHeaders as [name, value] (name + value)}
          <div class="header-item">
            <span class="header-key">{name}</span>
            <span class="header-val">{value}</span>
          </div>
        {/each}
      {/if}
    {/if}

    {#if sortedRequestCookies.length > 0}
      <div class="section-label cookies-label">
        Cookies
        <span class="section-meta"
          >· {sortedRequestCookies.length}{#if variesCount > 0}
            ({variesCount} varies cache){/if}</span
        >
      </div>
      {#each sortedRequestCookies as cookie (cookie.name)}
        <div class="header-item" class:varies-cache={cookie.varies}>
          <span class="header-key">
            {cookie.name}
            {#if cookie.varies}<span class="varies-chip">varies cache</span>{/if}
          </span>
          <span class="header-val">{cookie.value}</span>
        </div>
      {/each}
    {/if}
  </div>
</DebugPanel>

<style>
  .panel-title-meta {
    margin-left: 6px;
    color: #c8ccbf;
    font-weight: 400;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    letter-spacing: 0;
    text-transform: none;
  }
  .panel-title-sep {
    margin-right: 6px;
    color: #434836;
    font-size: 1.25em;
    line-height: 1;
  }
  .gzip-info {
    display: inline-flex;
    align-items: center;
    margin-left: 4px;
    color: #72786c;
    cursor: help;
    line-height: 0;
    position: relative;
    top: 1px;
  }
  .gzip-info:hover {
    color: #a8ada0;
  }
  .request-item {
    background: #2e3228;
    color: #f0eee5;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid #434836;
    font-size: 11px;
    line-height: 1.5;
    margin-bottom: 3px;
    display: flex;
    gap: 8px;
  }
  .request-key {
    color: #aab09f;
    flex-shrink: 0;
    min-width: 80px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding-top: 1px;
  }
  .request-val {
    color: #f0eee5;
    word-break: break-all;
    font-weight: 500;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .request-val.muted {
    color: #9aa094;
    font-weight: 400;
    font-style: italic;
  }
  .section-label {
    color: #e8e6dd;
    font-size: 10px;
    font-weight: 600;
    padding: 10px 6px 4px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-family: inherit;
  }
  .cookies-label {
    color: #d5b982;
  }
  .section-meta {
    color: #8e9488;
    font-weight: 400;
    margin-left: 4px;
    text-transform: none;
    letter-spacing: 0;
    font-size: 11px;
  }
  .varies-cache {
    border-left: 2px solid #8ab79a;
    padding-left: 8px;
  }
  .varies-chip {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    background: rgba(138, 183, 154, 0.15);
    color: #8ab79a;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    vertical-align: 1px;
  }
  .header-item {
    background: #2e3228;
    color: #f0eee5;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid #434836;
    font-size: 11px;
    line-height: 1.5;
    margin-bottom: 3px;
    display: flex;
    gap: 8px;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
  }
  .header-row {
    cursor: pointer;
    transition:
      background 120ms ease,
      border-color 120ms ease;
  }
  .header-row:hover {
    background: #353a2f;
    border-color: #5a604d;
  }
  .header-key {
    color: #aab09f;
    flex-shrink: 0;
    min-width: 100px;
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
  }
  .header-val {
    color: #f0eee5;
    word-break: break-all;
    font-weight: 500;
    flex: 1;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
</style>
