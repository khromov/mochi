<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import DebugPanel from './DebugPanel.svelte';
  import type { RequestCacheStats } from '../runtime/requestContext';
  import Trash from '../icons/trash-2.svelte';
  import ChevronRight from '../icons/chevron-right.svelte';
  import Copy from '../icons/copy.svelte';
  import Check from '../icons/check.svelte';
  import X from '../icons/x.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  type Status = 'idle' | 'clearing' | 'done' | 'error';
  let status: Status = $state('idle');
  let errorMsg = $state('');
  let count: number | null = $state(null);
  let keys: string[] | null = $state(null);
  let query = $state('');
  type CacheValue = { loading?: boolean; json?: string; error?: string; gone?: boolean };

  let expanded: Record<string, boolean> = $state({});
  let values: Record<string, CacheValue> = $state({});
  let copiedKey: string | null = $state(null);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const LABELS: Record<Status, string> = {
    idle: 'Empty image cache',
    clearing: 'Clearing…',
    done: 'Cleared ✓',
    error: 'Failed — retry',
  };

  const base = () => `${window.__mochi_asset_prefix ?? ''}/image-cache/`;

  const GONE_TEXT = 'No longer cached — evicted since this list was loaded.';

  async function refresh() {
    try {
      const res = await fetch(base());
      if (res.ok) {
        const data = (await res.json()) as { count?: number; keys?: string[] };
        count = typeof data.count === 'number' ? data.count : null;
        keys = Array.isArray(data.keys) ? data.keys : [];
      }
    } catch {
      /* leave the last known state */
    }
  }

  // Refresh the list each time the panel is opened so it reflects reality.
  $effect(() => {
    if (open) {
      void refresh();
    }
  });

  // Fetches and memoizes a key's stored value, shared by expand and copy. `gone` stays unmemoized: the key list is a
  // snapshot, so an entry evicted between listing and expanding can be repopulated just as easily, and caching that
  // verdict would keep reporting it as gone.
  async function loadValue(key: string): Promise<CacheValue> {
    const existing = values[key];
    if (existing && (existing.json !== undefined || existing.error !== undefined)) {
      return existing;
    }
    values[key] = { loading: true };
    try {
      const res = await fetch(`${base()}entry/?key=${encodeURIComponent(key)}`);
      // 410 means the handler ran and the key isn't stored — an evicted entry, not a
      // failure. Anything else non-ok is a real error worth showing verbatim.
      if (res.status === 410) {
        const result = { gone: true };
        values[key] = result;
        return result;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { value: unknown };
      const result = { json: JSON.stringify(data.value, null, 2) };
      values[key] = result;
      return result;
    } catch (err) {
      const result = { error: err instanceof Error ? err.message : String(err) };
      values[key] = result;
      return result;
    }
  }

  async function toggleKey(key: string) {
    expanded[key] = !expanded[key];
    if (expanded[key]) {
      await loadValue(key);
    }
  }

  // Copy the key and its value on two lines, loading the value first if needed.
  async function copyKey(key: string) {
    const result = await loadValue(key);
    const payload = result.json ?? result.error ?? (result.gone ? GONE_TEXT : '');
    try {
      await navigator.clipboard.writeText(`${key}\n${payload}`);
      copiedKey = key;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copiedKey = null), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function clearCache() {
    if (status === 'clearing') {
      return;
    }
    status = 'clearing';
    errorMsg = '';
    clearTimeout(resetTimer);
    try {
      const res = await fetch(base(), { method: 'POST' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { count?: number };
      count = typeof data.count === 'number' ? data.count : 0;
      keys = [];
      expanded = {};
      values = {};
      status = 'done';
      resetTimer = setTimeout(() => (status = 'idle'), 2000);
    } catch (err) {
      status = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
      resetTimer = setTimeout(() => (status = 'idle'), 4000);
    }
  }

  let normalizedQuery = $derived(query.trim().toLowerCase());
  let filtered = $derived.by<string[]>(() => {
    if (keys === null) {
      return [];
    }
    if (!normalizedQuery) {
      return keys;
    }
    return keys.filter((k) => k.toLowerCase().includes(normalizedQuery));
  });

  onDestroy(() => {
    clearTimeout(resetTimer);
    clearTimeout(copiedTimer);
  });

  // Request-cache stats are a snapshot of the render that produced this page —
  // baked into the shell, so there's nothing to fetch and nothing to refresh.
  let requestCache = $state<RequestCacheStats | null>(null);
  onMount(() => {
    requestCache = window.__mochi_debug?.requestCache ?? null;
  });

  let lookups = $derived((requestCache?.hits ?? 0) + (requestCache?.misses ?? 0));
  let hitRate = $derived(lookups === 0 ? '—' : `${Math.round(((requestCache?.hits ?? 0) / lookups) * 100)}%`);
  let rcKeys = $derived(requestCache?.keys ?? []);
  let rcKeysOpen = $state(false);
</script>

<DebugPanel title="Cache" color="#a7d0c4" {open} {onclose}>
  <div class="cache-body">
    {#if lookups === 0}
      <div class="rc-empty">Request cache <span>No request-cache lookups on this request.</span></div>
    {:else}
      <h3 class="cache-section">Request cache</h3>
      <div class="rc-stats">
        <div class="rc-stat rc-hits"><span class="rc-value">{requestCache?.hits ?? 0}</span><span class="rc-label">hits</span></div>
        <div class="rc-stat rc-misses"><span class="rc-value">{requestCache?.misses ?? 0}</span><span class="rc-label">misses</span></div>
        <div class="rc-stat rc-rate"><span class="rc-value">{hitRate}</span><span class="rc-label">hit rate</span></div>
        <div class="rc-stat rc-entries"><span class="rc-value">{requestCache?.entries ?? 0}</span><span class="rc-label">entries</span></div>
      </div>
      {#if rcKeys.length > 0}
        <div class="rc-keys" class:open={rcKeysOpen}>
          <button class="rc-keys-toggle" type="button" onclick={() => (rcKeysOpen = !rcKeysOpen)} aria-expanded={rcKeysOpen}>
            <span class="chevron"><ChevronRight size={12} /></span>
            <span>{rcKeys.length} {rcKeys.length === 1 ? 'key' : 'keys'}</span>
          </button>
          {#if rcKeysOpen}
            <ul class="rc-keys-list">
              {#each rcKeys as k (k.key)}
                <li>
                  <bdi class="rc-key-name">{k.key.replace(/:$/, '')}</bdi>
                  <span class="rc-key-tally">
                    <span class="rc-key-hits">{k.hits} {k.hits === 1 ? 'hit' : 'hits'}</span>
                    <span class="rc-key-misses">{k.misses} {k.misses === 1 ? 'miss' : 'misses'}</span>
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    {/if}

    <h3 class="cache-section">Image cache</h3>
    <p class="cache-desc">Empties the on-disk image cache — every original, resized variant, and blur placeholder.</p>
    <button class="cache-clear-btn" class:is-done={status === 'done'} class:is-error={status === 'error'} type="button" onclick={clearCache} disabled={status === 'clearing'}>
      <Trash size={13} />
      <span class="cache-clear-label">{LABELS[status]}</span>
      {#if count !== null}
        <span class="cache-count-badge">{count}</span>
      {/if}
    </button>
    {#if status === 'error' && errorMsg}
      <div class="cache-error">{errorMsg}</div>
    {/if}

    <div class="cache-search-wrap">
      <input class="cache-search" type="text" placeholder="Filter cache keys…" bind:value={query} aria-label="Filter cache keys" />
      {#if query}
        <button class="cache-search-clear" type="button" onclick={() => (query = '')} aria-label="Clear filter"><X size={12} /></button>
      {/if}
    </div>

    {#if keys === null}
      <div class="cache-note">Loading…</div>
    {:else if keys.length === 0}
      <div class="cache-note">Cache is empty.</div>
    {:else if filtered.length === 0}
      <div class="cache-note">No keys match "{query.trim()}".</div>
    {:else}
      {#each filtered as key (key)}
        <div class="cache-row" class:open={expanded[key]}>
          <div class="cache-row-top">
            <button class="cache-row-header" type="button" onclick={() => toggleKey(key)}>
              <span class="chevron"><ChevronRight size={12} /></span>
              <span class="cache-key" class:searching={normalizedQuery !== ''}><bdi>{key}</bdi></span>
            </button>
            <button class="cache-copy-btn" class:copied={copiedKey === key} type="button" onclick={() => copyKey(key)} title="Copy key and value" aria-label="Copy key and value">
              {#if copiedKey === key}<Check size={12} />{:else}<Copy size={12} />{/if}
            </button>
          </div>
          {#if expanded[key]}
            <div class="cache-value">
              {#if values[key]?.loading}
                <span class="cache-value-note">Loading…</span>
              {:else if values[key]?.gone}
                <span class="cache-value-note">{GONE_TEXT}</span>
              {:else if values[key]?.error}
                <span class="cache-value-note error">{values[key]?.error}</span>
              {:else}
                <pre>{values[key]?.json}</pre>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</DebugPanel>

<style>
  .cache-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cache-desc {
    margin: 0;
    color: #9aa094;
    font-size: 11px;
    line-height: 1.5;
    padding: 0 2px;
  }
  .cache-desc code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    color: #c8ece0;
  }
  .cache-section {
    margin: 0;
    padding: 0 2px;
    color: #6fae9c;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .cache-section:not(:first-child) {
    margin-top: 8px;
    padding-top: 10px;
    border-top: 1px solid #353930;
  }
  .rc-empty {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 0 2px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    /* Slightly grayed vs. the active #6fae9c heading, to read as inactive. */
    color: #5c7a70;
  }
  .rc-empty span {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    color: #72786c;
    font-style: italic;
  }
  .rc-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .rc-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    border: 1px solid;
    border-radius: 5px;
    padding: 4px 3px;
  }
  .rc-value {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
  }
  .rc-label {
    font-size: 8px;
    letter-spacing: 0.04em;
  }
  /* Each tile gets its own muted hue so the four read apart at a glance. */
  .rc-hits {
    background: #22301f;
    border-color: #3a4f33;
  }
  .rc-hits .rc-value {
    color: #b6d8a0;
  }
  .rc-hits .rc-label {
    color: #7f9670;
  }
  .rc-misses {
    background: #322324;
    border-color: #52393b;
  }
  .rc-misses .rc-value {
    color: #e0aeae;
  }
  .rc-misses .rc-label {
    color: #9c7f80;
  }
  .rc-rate {
    background: #262433;
    border-color: #3a3550;
  }
  .rc-rate .rc-value {
    color: #c4bce6;
  }
  .rc-rate .rc-label {
    color: #8a83a6;
  }
  .rc-entries {
    background: #322d1f;
    border-color: #524a33;
  }
  .rc-entries .rc-value {
    color: #e6d3a0;
  }
  .rc-entries .rc-label {
    color: #9c9270;
  }
  .rc-keys {
    margin-top: 6px;
  }
  .rc-keys-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: none;
    border: none;
    color: #9aa094;
    font: inherit;
    font-size: 11px;
    padding: 2px;
    cursor: pointer;
    text-align: left;
  }
  .rc-keys-toggle:hover {
    color: #c8ece0;
  }
  .rc-keys.open .rc-keys-toggle .chevron {
    transform: rotate(90deg);
    color: #6fae9c;
  }
  .rc-keys-list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rc-keys-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    color: #c7cabf;
    background: #1c1f17;
    border: 1px solid #353930;
    border-radius: 4px;
    padding: 4px 8px;
  }
  .rc-key-name {
    unicode-bidi: isolate;
    flex: 1;
    min-width: 0;
    word-break: break-all;
  }
  .rc-key-tally {
    flex-shrink: 0;
    display: inline-flex;
    gap: 5px;
    font-size: 9px;
  }
  .rc-key-hits {
    color: #b6d8a0;
  }
  .rc-key-misses {
    color: #e0aeae;
  }
  .cache-clear-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: #223833;
    color: #a7d0c4;
    border: 1px solid #3f5f54;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease,
      border-color 120ms ease;
  }
  .cache-clear-label {
    flex: 0 1 auto;
  }
  .cache-count-badge {
    border-radius: 999px;
    min-width: 1.5em;
    height: 1.5em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.82em;
    font-weight: 600;
    padding: 0 0.5em;
    background: rgba(111, 174, 156, 0.28);
    color: #d4f0e6;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: 0;
  }
  .cache-clear-btn:hover:not(:disabled) {
    background: #2b453e;
    color: #c8ece0;
    border-color: #6fae9c;
  }
  .cache-clear-btn:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .cache-clear-btn.is-done {
    background: #234034;
    color: #b6e8c8;
    border-color: #4f8a63;
  }
  .cache-clear-btn.is-error {
    background: #402823;
    color: #f4b6a7;
    border-color: #7a3a2a;
  }
  .cache-error {
    color: #f4b6a7;
    font-size: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    padding: 0 2px;
    word-break: break-all;
  }
  .cache-search-wrap {
    position: relative;
    margin-top: 2px;
  }
  .cache-search {
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
  .cache-search::placeholder {
    color: #72786c;
    font-style: italic;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .cache-search:focus {
    border-color: #6fae9c;
    box-shadow: 0 0 0 1px rgba(111, 174, 156, 0.25);
  }
  .cache-search-clear {
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
  .cache-search-clear:hover {
    color: #6fae9c;
    background: rgba(111, 174, 156, 0.12);
  }
  .cache-note {
    color: #72786c;
    font-size: 11px;
    padding: 10px;
    text-align: center;
    font-style: italic;
  }
  .cache-row {
    background: #272a22;
    border: 1px solid #353930;
    border-radius: 6px;
    overflow: hidden;
  }
  .cache-row-top {
    display: flex;
    align-items: center;
  }
  .cache-row-header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    background: none;
    border: none;
    color: #e8e6dd;
    font: inherit;
    padding: 6px 4px 6px 10px;
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }
  .cache-row-top:hover {
    background: #2d3128;
  }
  .cache-copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    align-self: stretch;
    background: none;
    border: none;
    border-left: 1px solid #353930;
    color: #8e9488;
    padding: 0 8px;
    cursor: pointer;
    transition:
      color 120ms ease,
      background 120ms ease;
  }
  .cache-copy-btn:hover {
    color: #c8ece0;
    background: rgba(111, 174, 156, 0.12);
  }
  .cache-copy-btn.copied {
    color: #6fae9c;
  }
  .chevron {
    color: #8e9488;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    transition:
      transform 120ms ease,
      color 120ms ease;
  }
  .cache-row.open .chevron {
    transform: rotate(90deg);
    color: #6fae9c;
    margin-top: 1px;
  }
  /* Keep the chevron + copy button pinned to the first line when the full key wraps. */
  .cache-row.open .cache-row-top,
  .cache-row.open .cache-row-header {
    align-items: flex-start;
  }
  .cache-row.open .cache-copy-btn {
    align-self: stretch;
  }
  .cache-key {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .cache-key bdi {
    unicode-bidi: isolate;
  }
  /* While searching, keys share a long common prefix, so truncate the START and
     keep the distinguishing tail visible (leading ellipsis via rtl flow). */
  .cache-key.searching {
    direction: rtl;
    text-align: left;
  }
  /* Expanded rows show the full key — wrap instead of truncating. */
  .cache-row.open .cache-key {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    word-break: break-all;
    direction: ltr;
  }
  .cache-value {
    border-top: 1px solid #353930;
    padding: 8px 10px;
    background: #1c1f17;
  }
  .cache-value pre {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    line-height: 1.5;
    color: #c7cabf;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 220px;
    overflow: auto;
  }
  .cache-value-note {
    font-size: 10px;
    color: #8e9488;
    font-style: italic;
  }
  .cache-value-note.error {
    color: #f4b6a7;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-style: normal;
  }
</style>
