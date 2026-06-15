<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);

  let { renderedAt, userAgent, random }: { renderedAt: string; userAgent: string; random: number } = $props();
</script>

<DemoPage
  title="Server Props"
  description="You can pass data from the route definition into the root Svelte component for the route via a serverProps resolver. The resolver runs on every request, so each reload produces fresh values."
  {sources}
>
  <div class="card">
    <dl>
      <dt>Rendered at</dt>
      <dd><code>{renderedAt}</code></dd>

      <dt>Random number</dt>
      <dd><code>{random}</code></dd>

      <dt>Your User-Agent</dt>
      <dd><code>{userAgent}</code></dd>
    </dl>
    <p class="hint">Reload the page to see the values change — each request re-runs the resolver.</p>
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
    margin: 0;
  }
</style>
