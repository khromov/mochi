<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import HydrationTarget from './HydrationTarget.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'Hydration.svelte', path: './src/demos/hydration/Hydration.svelte' },
    { label: 'HydrationTarget.svelte', path: './src/demos/hydration/HydrationTarget.svelte' },
    { label: 'routes.ts', path: './src/demos/hydration/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Hydration Modes"
  description="You can render components in multiple ways: pure SSR, mochi:hydrate, mochi:hydrate:visible (default and with rootMargin), and mochi:defer. Each card in the demo below turns green when it hydrates — click to confirm JavaScript has taken over. Scroll to reach the lazy islands."
  {sources}
>
  <section class="mode">
    <header>
      <h2>No directive</h2>
      <p>Pure SSR — no client JavaScript is shipped for this component. It renders on the server and is inert in the browser. Best for content that never needs interactivity.</p>
    </header>
    <HydrationTarget label="<HydrationTarget />" />
  </section>

  <section class="mode">
    <header>
      <h2>mochi:hydrate</h2>
      <p>Eager hydration — the island ships and boots immediately when the page loads. Use for above-the-fold UI that needs to be interactive right away.</p>
    </header>
    <HydrationTarget mochi:hydrate label="<HydrationTarget mochi:hydrate />" />
  </section>

  <section class="mode">
    <header>
      <h2>mochi:hydrate:visible</h2>
      <p>
        Lazy hydration — the bundle and CSS are only fetched once the island scrolls into view (via an <code>IntersectionObserver</code>). The card below stays inert until you
        scroll it into the viewport.
      </p>
    </header>
    <div class="spacer">
      <p>↓ Scroll down ↓</p>
    </div>
    <HydrationTarget mochi:hydrate:visible label="<HydrationTarget mochi:hydrate:visible />" />
  </section>

  <section class="mode">
    <header>
      <h2>mochi:hydrate:visible</h2>
      <p>
        You can pass <code>IntersectionObserver</code> options — here
        <code>rootMargin: '200px'</code>
        starts hydration a bit before the island is actually in view.
      </p>
    </header>
    <HydrationTarget mochi:hydrate:visible={{ rootMargin: '200px' }} label={`<HydrationTarget mochi:hydrate:visible={{ rootMargin: '200px' }} />`} />
  </section>

  <section class="mode">
    <header>
      <h2>mochi:defer</h2>
      <p>
        Server island — the component is <em>not</em> in the initial page. A placeholder ships, then the browser fetches the rendered HTML on demand. Pair with hydrated child components
        to also hydrate parts of the island after it loads.
      </p>
    </header>
    <HydrationTarget mochi:defer mochi:hydrate label="<HydrationTarget mochi:defer mochi:hydrate />">
      <div class="placeholder">Loading from server…</div>
    </HydrationTarget>
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

  .spacer {
    height: 60vh;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px dashed var(--border);
    border-radius: var(--radius-md);
    color: var(--text-subtle);
    font-size: 0.9rem;
  }

  .spacer p {
    margin: 0;
  }

  .placeholder {
    padding: 1rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--text-subtle);
    text-align: center;
    font-size: 0.9rem;
  }
</style>
