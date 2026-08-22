<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import Reactivity from './Reactivity.svelte';
  import StateCard from './StateCard.svelte';
  import Elements from './Elements.svelte';
  import Sensors from './Sensors.svelte';
  import AsyncFsm from './AsyncFsm.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { highlightCode } from '../../lib/highlight.server';
  import { files } from './files.ts';

  const sources = await loadSources(files);

  const codeInstall = await highlightCode('bun add runed', 'bash');
  const codeUsage = await highlightCode(
    `import { Debounced } from 'runed';

let query = $state('');
const search = new Debounced(() => query, 400);
// search.current — query, 400ms after it stops changing`,
    'typescript',
  );
</script>

<DemoPage
  title="Runed Utilities"
  description="Runed is a Svelte 5 collection of reactive utilities built on runes. Because most of them read the DOM, timers, or device sensors, each card is its own mochi:hydrate island — the page renders on the server with default values, then Runed brings it to life on the client."
  {sources}
>
  <div class="intro">
    <p>
      Runed needs no special setup — it's a plain Svelte 5 runes library, so you install it and import from
      <code>runed</code>. In Mochi it bundles straight into whichever island imports it.
    </p>
    <CodeSnippet html={codeInstall} />
    <p>Then import a utility and use it like any rune — e.g. the <code>Debounced</code> value driving the first card:</p>
    <CodeSnippet html={codeUsage} />
    <p>Explore the full toolkit at <a href="https://runed.dev" target="_blank" rel="noopener noreferrer">runed.dev</a>.</p>
  </div>

  <section class="card">
    <header>
      <h2>Reactivity & timing</h2>
      <p><code>Debounced</code>, <code>Throttled</code>, <code>Previous</code>, and <code>watch</code> — one input, four derived views.</p>
    </header>
    <Reactivity mochi:hydrate />
  </section>

  <section class="card">
    <header>
      <h2>State</h2>
      <p><code>StateHistory</code> undo/redo, <code>PersistedState</code> across reloads and tabs, and <code>IsMounted</code>.</p>
    </header>
    <StateCard mochi:hydrate />
  </section>

  <section class="card">
    <header>
      <h2>Elements & observers</h2>
      <p><code>ElementSize</code> + <code>useResizeObserver</code>, <code>IsInViewport</code>, <code>activeElement</code>, and <code>IsFocusWithin</code>.</p>
    </header>
    <Elements mochi:hydrate />
  </section>

  <section class="card">
    <header>
      <h2>Sensors & animation</h2>
      <p><code>PressedKeys</code>, <code>IsIdle</code>, and <code>AnimationFrames</code> with a live FPS cap.</p>
    </header>
    <Sensors mochi:hydrate />
  </section>

  <section class="card">
    <header>
      <h2>State machine & async</h2>
      <p>A self-driving <code>FiniteStateMachine</code> traffic light and a debounced <code>resource</code> search over a Mochi API.</p>
    </header>
    <AsyncFsm mochi:hydrate />
  </section>
</DemoPage>

<style>
  .intro {
    font-size: 0.95rem;
    color: var(--text-muted);
    margin: 0 0 1.75rem;
  }

  .intro p {
    margin: 0 0 0.75rem;
  }

  .intro a {
    color: var(--accent);
    text-decoration: underline;
  }

  .intro > p:last-child {
    margin-bottom: 0;
  }

  .intro p code {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
  }

  .card {
    margin-bottom: 2rem;
  }

  .card header {
    margin-bottom: 0.9rem;
  }

  .card header p {
    font-size: 0.95rem;
    color: var(--text-muted);
    margin: 0.25rem 0 0;
  }

  .card header code {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
  }
</style>
