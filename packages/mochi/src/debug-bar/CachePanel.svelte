<script lang="ts">
  import { onDestroy } from 'svelte';
  import DebugPanel from './DebugPanel.svelte';
  import Trash from '../icons/trash-2.svelte';
  import ChevronRight from '../icons/chevron-right.svelte';
  import X from '../icons/x.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  type Status = 'idle' | 'clearing' | 'done' | 'error';
  let status: Status = $state('idle');
  let errorMsg = $state('');
  let count: number | null = $state(null);
  let keys: string[] | null = $state(null);
  let query = $state('');
  let expanded: Record<string, boolean> = $state({});
  let values: Record<string, { loading?: boolean; json?: string; error?: string }> = $state({});
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  const LABELS: Record<Status, string> = {
    idle: 'Empty image cache',
    clearing: 'Clearing…',
    done: 'Cleared ✓',
    error: 'Failed — retry',
  };

  const base = () => `${window.__mochi_asset_prefix ?? ''}/image-cache/`;

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

  async function toggleKey(key: string) {
    expanded[key] = !expanded[key];
    if (expanded[key] && values[key] === undefined) {
      values[key] = { loading: true };
      try {
        const res = await fetch(`${base()}entry/?key=${encodeURIComponent(key)}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { value: unknown };
        values[key] = { json: JSON.stringify(data.value, null, 2) };
      } catch (err) {
        values[key] = { error: err instanceof Error ? err.message : String(err) };
      }
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

  onDestroy(() => clearTimeout(resetTimer));
</script>

<DebugPanel title="Cache" color="#a7d0c4" {open} {onclose}>
  <div class="cache-body">
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
          <button class="cache-row-header" type="button" onclick={() => toggleKey(key)}>
            <span class="chevron"><ChevronRight size={12} /></span>
            <span class="cache-key">{key}</span>
          </button>
          {#if expanded[key]}
            <div class="cache-value">
              {#if values[key]?.loading}
                <span class="cache-value-note">Loading…</span>
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
  .cache-row-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: none;
    border: none;
    color: #e8e6dd;
    font: inherit;
    padding: 6px 10px;
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }
  .cache-row-header:hover {
    background: #2d3128;
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
  }
  .cache-key {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
