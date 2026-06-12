<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils';
  import { getReport, dbPath } from './cache';

  const sources = await loadSources([
    { label: 'SqliteCache.svelte', path: './src/demos/sqlite-cache/SqliteCache.svelte' },
    { label: 'cache.ts', path: './src/demos/sqlite-cache/cache.ts' },
    { label: 'routes.ts', path: './src/demos/sqlite-cache/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);

  const { value, status } = await getReport();
</script>

<DemoPage
  title="SQLite Cache"
  description="MochiCache with the built-in SqliteStorage backend persists entries to a bun:sqlite file instead of process memory. The cached timestamp survives a server restart — stop and start the dev server, refresh, and it's still served from disk."
  {sources}
>
  <div class="card">
    <div class="row">
      <div>
        <span class="label">Computed at</span>
        <code>{value.computedAt}</code>
      </div>
      <div>
        <span class="label">Status</span>
        <span class="status status-{status}">{status}</span>
      </div>
    </div>

    <p class="hint">
      The entry is stored in <code>{dbPath}</code>. Refresh within <strong>15s</strong> for a <code>fresh</code> hit; between <strong>15–60s</strong> you get the
      <code>stale</code>
      value plus a background revalidate; after <strong>60s</strong> the next refresh blocks on a recompute (<code>expired</code>). Restart the server and refresh — the same
      timestamp comes back, because it lives on disk, not in memory.
    </p>

    <form method="POST" action="?/clear">
      <button type="submit">Clear cache (clearItems)</button>
    </form>
  </div>
</DemoPage>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    align-items: baseline;
  }

  .label {
    display: block;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-bottom: 0.2rem;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.92rem;
    color: var(--text);
    overflow-wrap: anywhere;
  }

  .hint {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0;
  }

  form {
    margin: 0;
  }

  button {
    padding: 0.4rem 0.8rem;
    font-size: 0.85rem;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  button:hover {
    border-color: var(--text-muted);
  }

  .status {
    font-size: 0.78rem;
    padding: 0.05rem 0.4rem;
    border-radius: 4px;
    border: 1px solid var(--border);
  }

  .status-fresh {
    background: var(--badge-success-bg);
    color: var(--badge-success-text);
    border-color: transparent;
  }

  .status-stale {
    background: var(--badge-warning-bg);
    color: var(--badge-warning-text);
    border-color: transparent;
  }

  .status-expired {
    background: var(--badge-danger-bg);
    color: var(--badge-danger-text);
    border-color: transparent;
  }

  .status-miss {
    background: var(--badge-default-bg);
    color: var(--badge-default-text);
    border-color: transparent;
  }
</style>
