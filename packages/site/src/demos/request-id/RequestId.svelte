<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import Fetcher from './Fetcher.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);

  let { requestId }: { requestId: string } = $props();
</script>

<DemoPage
  title="Request ID"
  description="Every HTTP request carries a stable correlation id. Read it from any server-side code with getRequestContext().requestId — it's a Bun.randomUUIDv7() by default (time-ordered), can be seeded from an upstream proxy.requestIdHeader, and the same id rides every lifecycle event (request, error, action:*) so observability tooling can stitch a request together."
  {sources}
>
  <div class="card">
    <dl>
      <dt>This page render</dt>
      <dd><code>{requestId}</code></dd>
    </dl>
    <p class="hint">Reload the page to get a fresh id — each request re-runs the resolver.</p>

    <Fetcher mochi:hydrate />
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
    word-break: break-all;
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
    margin: 0 0 1.25rem 0;
  }
</style>
