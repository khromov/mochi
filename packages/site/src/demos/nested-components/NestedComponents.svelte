<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import Level from './Level.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Nested Components"
  description="Hydrating a component with mochi:hydrate automatically hydrates all its children. Nested mochi:hydrate directives are forbidden and result in a fatal error."
  {sources}
>
  <section class="mode">
    <header>
      <h2><code>mochi:hydrate</code> on the root</h2>
      <p>One island wraps the whole five-level tree. Mochi serializes the root and its descendants once, ships a single bundle, and Svelte hydrates the entire subtree together.</p>
    </header>
    <Level mochi:hydrate />
  </section>

  <section class="mode">
    <header>
      <h2><code>mochi:defer</code> + <code>mochi:hydrate</code></h2>
      <p>
        The same recursive tree, rendered lazily as a server island. The placeholder ships with the page; the browser fetches the rendered HTML on demand. Because <code
          >mochi:hydrate</code
        > is also set, Svelte takes over once the fetched markup lands.
      </p>
    </header>
    <Level mochi:defer mochi:hydrate>
      <div class="placeholder">Loading nested tree from server<span class="dots"></span></div>
    </Level>
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

  .placeholder {
    padding: 1rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text-subtle);
    font-style: italic;
    text-align: center;
  }

  .dots::after {
    content: '';
    display: inline-block;
    width: 1.5em;
    text-align: left;
    animation: dots 1.2s steps(4, end) infinite;
  }

  @keyframes dots {
    0% {
      content: '';
    }
    25% {
      content: '.';
    }
    50% {
      content: '..';
    }
    75% {
      content: '...';
    }
  }
</style>
