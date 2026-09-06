<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import HydrationProbe from './HydrationProbe.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await compiled(() => loadSources(files));
</script>

<DemoPage
  title="isHydratable()"
  description="isHydratable() reports whether the calling component is part of a subtree that will hydrate on this page load — at any nesting depth, with no prop forwarding. The same three-level probe is rendered four ways."
  {sources}
>
  <section class="mode">
    <header>
      <h2><code>mochi:hydrate</code></h2>
      <p>The island root seeds the whole subtree: every depth reports <code>true</code>.</p>
    </header>
    <HydrationProbe mochi:hydrate />
  </section>

  <section class="mode">
    <header>
      <h2>Plain SSR</h2>
      <p>The same tree without a directive never hydrates: every depth reports <code>false</code>.</p>
    </header>
    <HydrationProbe />
  </section>

  <section class="mode">
    <header>
      <h2><code>mochi:defer</code></h2>
      <p>A pure server island is fetched as HTML and never hydrates, so it also reports <code>false</code> — deferred is not hydrated.</p>
    </header>
    <HydrationProbe mochi:defer />
  </section>

  <section class="mode">
    <header>
      <h2><code>mochi:defer mochi:hydrate</code></h2>
      <p>An also-hydrated server island takes over after the fetch, so every depth reports <code>true</code>.</p>
    </header>
    <HydrationProbe mochi:defer mochi:hydrate />
  </section>
</DemoPage>

<style>
  .mode {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 2.5rem;
  }

  .mode header {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .mode h2 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 1.35rem;
    font-weight: 500;
  }

  .mode h2 code,
  .mode p code {
    font-family: var(--font-mono);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
    font-weight: 500;
  }

  .mode p {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
  }
</style>
