<script lang="ts">
  import CacheView from './CacheView.svelte';

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

  let { stats, entries }: { stats: PageCacheStats; entries: PageCacheEntryMeta[] } = $props();
</script>

<svelte:head>
  <title>Mochi · Page cache</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<div class="wrap">
  <header class="page-header">
    <div>
      <h1>Page cache</h1>
      <div class="subtitle">Dev-only admin. Placeholder data — the page cache is being rebuilt.</div>
    </div>
  </header>

  <CacheView mochi:hydrate {stats} {entries} />
</div>

<style>
  :global(html, body) {
    margin: 0;
    overflow-x: hidden;
  }
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }
  :global(body) {
    background: #0d1117;
    color: #c9d1d9;
    font:
      13px/1.5 ui-monospace,
      SFMono-Regular,
      Menlo,
      monospace;
  }
  .wrap {
    padding: 24px;
  }
  .page-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 16px;
    gap: 16px;
    flex-wrap: wrap;
  }
  h1 {
    color: #5eead4;
    margin: 0;
    font-size: 18px;
  }
  .subtitle {
    color: #8b949e;
  }
</style>
