<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);

  let { used, limit, resetIn }: { used: number; limit: number; resetIn: number } = $props();
</script>

<DemoPage
  title="Rate Limiting"
  description="Add rateLimit to any Mochi.page() or Mochi.api() route — or globally on Mochi.serve() — to throttle requests per client. Requests are keyed by the proxy-aware client IP by default, memory-backed out of the box, with sqliteStore and postgresStore for persistence. Blocked page routes render the error page with a 429; API routes return JSON with RateLimit-* headers."
  {sources}
>
  <div class="card">
    <dl>
      <dt>Requests used</dt>
      <dd><code>{used} of {limit}</code></dd>
      <dt>Window resets in</dt>
      <dd><code>{resetIn}s</code></dd>
    </dl>
    <p class="hint">
      Reload this page. This route allows {limit} requests per minute per IP — after the {limit}th reload you'll get a 429 error page. Wait for the window to reset, then reload to
      get back in.
    </p>
  </div>
</DemoPage>

<style>
  .card {
    background: var(--surface);
    color: var(--text);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    padding: 1.5rem;
    max-width: 560px;
    margin: 0 auto;
  }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 1.25rem;
    row-gap: 0.75rem;
    margin: 0 0 1rem 0;
  }

  dt {
    font-weight: 600;
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    color: var(--text);
  }

  code {
    font-family: var(--font-mono);
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.2rem 0.45rem;
    border-radius: var(--radius-sm);
    font-size: 0.9em;
  }

  .hint {
    color: var(--text-subtle);
    font-size: 0.9rem;
    margin: 0;
  }
</style>
