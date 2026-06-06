<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils';
  import { getSlowTime } from './log';

  const sources = await loadSources([
    { label: 'CacheEvents.svelte', path: './src/demos/cache-events/CacheEvents.svelte' },
    { label: 'log.ts', path: './src/demos/cache-events/log.ts' },
    { label: 'routes.ts', path: './src/demos/cache-events/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);

  const { value: time, status } = await getSlowTime();
</script>

<DemoPage
  title="Cache Events"
  description="You can register a handler on mochiEvents to observe cache events. In this demo we are printing each one to the server console with a [demo:cache-events] prefix. After adding this code, refresh the page and watch your server terminal."
  {sources}
>
  <div class="card">
    <div class="row">
      <div>
        <span class="label">Cached value</span>
        <code>{time}</code>
      </div>
      <div>
        <span class="label">Status</span>
        <span class="status status-{status}">{status}</span>
      </div>
    </div>
    <p class="hint">
      Refresh under <strong>3s</strong> for a <code>fresh</code> hit. Refresh between
      <strong>3–10s</strong>
      for <code>stale</code> + a background revalidate. After <strong>10s</strong> the next refresh blocks on a fresh fetch (<code>expired</code>). Each event logs to your server
      console.
    </p>
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
  }

  .hint {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0;
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
