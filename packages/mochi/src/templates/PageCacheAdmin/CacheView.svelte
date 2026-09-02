<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from 'mochi-framework';
  import type { MochiSubmitFunction } from 'mochi-framework';
  import { formatSize } from '../../debug-bar/utils';

  type PageCacheStats = { size: number; totalBytes: number };
  type PageCacheEntryMeta = {
    key: string;
    path: string;
    search: string;
    status: number;
    contentEncoding: string;
    bodySize: number;
    cachedAt: number;
    hits: number;
  };

  let {
    stats: initialStats,
    entries: initialEntries,
  }: {
    stats: PageCacheStats;
    entries: PageCacheEntryMeta[];
  } = $props();

  // svelte-ignore state_referenced_locally
  let stats = $state<PageCacheStats>(initialStats);
  // svelte-ignore state_referenced_locally
  let entries = $state<PageCacheEntryMeta[]>(initialEntries);

  type SortKey = 'path' | 'status' | 'contentEncoding' | 'bodySize' | 'cachedAt' | 'hits';
  type SortDir = 'asc' | 'desc';

  const SORT_KEYS = new Set<SortKey>(['path', 'status', 'contentEncoding', 'bodySize', 'cachedAt', 'hits']);

  let sortKey = $state<SortKey>('cachedAt');
  let sortDir = $state<SortDir>('desc');
  const LS_HIDE = 'mochi:admin:hideInternalPaths';
  const LS_SORT_KEY = 'mochi:admin:sortKey';
  const LS_SORT_DIR = 'mochi:admin:sortDir';
  let hideInternalPaths = $state(false);
  let mounted = $state(false);

  onMount(() => {
    hideInternalPaths = localStorage.getItem(LS_HIDE) === 'true';
    const savedKey = localStorage.getItem(LS_SORT_KEY) as SortKey | null;
    if (savedKey && SORT_KEYS.has(savedKey)) {
      sortKey = savedKey;
    }
    const savedDir = localStorage.getItem(LS_SORT_DIR);
    if (savedDir === 'asc' || savedDir === 'desc') {
      sortDir = savedDir;
    }
    mounted = true;
  });

  $effect(() => {
    if (!mounted) {
      return;
    }
    localStorage.setItem(LS_HIDE, String(hideInternalPaths));
    localStorage.setItem(LS_SORT_KEY, sortKey);
    localStorage.setItem(LS_SORT_DIR, sortDir);
  });

  let filteredEntries = $derived(hideInternalPaths ? entries.filter((e) => !e.path.startsWith('/_mochi')) : entries);

  let sortedEntries = $derived(
    [...filteredEntries].sort((a, b) => {
      const va: string | number = sortKey === 'path' ? a.path + a.search : a[sortKey];
      const vb: string | number = sortKey === 'path' ? b.path + b.search : b[sortKey];
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === 'asc' ? cmp : -cmp;
    }),
  );

  function setSort(key: SortKey): void {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  async function refresh(): Promise<void> {
    const [s, e] = await Promise.all([
      fetch('/__mochi/admin/page-cache/stats').then((r) => r.json() as Promise<PageCacheStats>),
      fetch('/__mochi/admin/page-cache/entries').then((r) => r.json() as Promise<PageCacheEntryMeta[]>),
    ]);
    stats = s;
    entries = e;
  }

  $effect(() => {
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  });

  const onPurge: MochiSubmitFunction = () => {
    return async ({ result }) => {
      if (result.type === 'success') {
        await refresh();
      }
    };
  };

  function fmtAge(cachedAt: number): string {
    const s = Math.max(0, Math.round((Date.now() - cachedAt) / 1000));
    if (s < 60) {
      return `${s}s`;
    }
    if (s < 3600) {
      return `${Math.round(s / 60)}m`;
    }
    return `${Math.round(s / 3600)}h`;
  }

  type VaryChip = { label: string; body: string };
  function varyChips(key: string): VaryChip[] {
    const out: VaryChip[] = [];
    for (const part of key.split('\n').slice(1)) {
      const eq = part.indexOf('=');
      if (eq < 0 || part.slice(eq + 1) === '') {
        continue;
      }
      const label = part.startsWith('h:') ? 'header' : part.startsWith('c:') ? 'cookie' : '';
      out.push({ label, body: label ? part.slice(2) : part });
    }
    return out;
  }

  function confirmPurgeAll(e: Event): void {
    if (!confirm(`Purge all ${entries.length} cached entries?`)) {
      e.preventDefault();
    }
  }
</script>

<div class="stats">
  <div class="stat">
    <div class="stat-label">Entries</div>
    <div class="stat-value">{stats.size}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Total bytes</div>
    <div class="stat-value">{formatSize(stats.totalBytes)}</div>
  </div>
</div>

<div class="toolbar">
  <button type="button" onclick={refresh}>Refresh</button>
  <label class="filter-label">
    <input type="checkbox" bind:checked={hideInternalPaths} />
    Hide /_mochi* paths
  </label>
  <form method="POST" action="?/purgeAll" onsubmit={confirmPurgeAll} {@attach enhance(onPurge)}>
    <button type="submit" class="danger">Purge all</button>
  </form>
</div>

<table>
  <thead>
    <tr>
      <th><button type="button" onclick={() => setSort('path')}>Path{sortKey === 'path' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
      <th><button type="button" onclick={() => setSort('status')}>Status{sortKey === 'status' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
      <th><button type="button" onclick={() => setSort('contentEncoding')}>Encoding{sortKey === 'contentEncoding' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
      <th><button type="button" onclick={() => setSort('bodySize')}>Size{sortKey === 'bodySize' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
      <th><button type="button" onclick={() => setSort('cachedAt')}>Age{sortKey === 'cachedAt' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
      <th><button type="button" onclick={() => setSort('hits')}>Hits{sortKey === 'hits' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
      <th></th>
    </tr>
  </thead>
  <tbody>
    {#if mounted}
      {#if entries.length === 0}
        <tr><td colspan="7" class="empty">No entries cached yet — make a request to a route covered by a rule.</td></tr>
      {:else}
        {#each sortedEntries as e (e.key)}
          {@const chips = varyChips(e.key)}
          {@const encoding = e.contentEncoding || 'identity'}
          {@const isIdentity = encoding === 'identity'}
          <tr>
            <td class="path">
              {e.path}{e.search}
              {#if chips.length > 0}
                <div class="vary">
                  {#each chips as c, i (i)}
                    {#if i > 0}<span class="sep"> · </span>{/if}
                    <span><span class="vary-label">{c.label}</span>{c.body}</span>
                  {/each}
                </div>
              {/if}
            </td>
            <td class:status-200={e.status === 200}>{e.status}</td>
            <td class="encoding" class:identity={isIdentity}>{isIdentity ? 'identity (no compression)' : encoding}</td>
            <td class="size">{formatSize(e.bodySize)}</td>
            <td class="age">{fmtAge(e.cachedAt)}</td>
            <td class="hits">{e.hits}</td>
            <td class="action">
              <form method="POST" action="?/purge" {@attach enhance(onPurge)}>
                <input type="hidden" name="path" value={e.path} />
                <button type="submit">Purge</button>
              </form>
            </td>
          </tr>
        {/each}
      {/if}
    {/if}
  </tbody>
</table>

<style>
  .stats {
    display: flex;
    gap: 24px;
    margin-bottom: 16px;
  }
  .stat {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 6px;
    padding: 10px 16px;
    min-width: 120px;
  }
  .stat-label {
    color: #8b949e;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .stat-value {
    color: #5eead4;
    font-size: 22px;
    font-weight: 600;
    margin-top: 4px;
    font-variant-numeric: tabular-nums;
  }
  .toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }
  .toolbar form {
    margin: 0;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th {
    color: #8b949e;
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid #21262d;
    font-weight: normal;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.05em;
  }
  td {
    padding: 6px 10px;
    border-bottom: 1px solid #161b22;
    vertical-align: top;
  }
  td.path {
    color: #79c0ff;
    word-break: break-all;
  }
  .vary {
    color: #6e7681;
    font-size: 11px;
    margin-top: 2px;
  }
  .vary-label {
    color: #484f58;
    margin-right: 4px;
  }
  .sep {
    color: #484f58;
  }
  td.size,
  td.age,
  td.hits {
    text-align: right;
    color: #a5d6ff;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  td.encoding {
    color: #d2a8ff;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  td.encoding.identity {
    color: #6e7681;
  }
  td.status-200 {
    color: #56d364;
  }
  td.action {
    text-align: right;
    white-space: nowrap;
  }
  td.action form {
    margin: 0;
  }
  th button {
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    padding: 0;
    cursor: pointer;
    white-space: nowrap;
  }
  th button:hover {
    background: none;
    border-color: transparent;
    color: #c9d1d9;
  }
  button {
    background: #21262d;
    color: #c9d1d9;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 4px 12px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover {
    background: #30363d;
    border-color: #5eead4;
    color: #5eead4;
  }
  button.danger:hover {
    border-color: #f85149;
    color: #f85149;
  }
  .empty {
    color: #8b949e;
    padding: 32px 0;
    text-align: center;
  }
  .filter-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #8b949e;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }
</style>
