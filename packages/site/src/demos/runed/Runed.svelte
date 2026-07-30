<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import Reactivity from './Reactivity.svelte';
  import StateCard from './StateCard.svelte';
  import Elements from './Elements.svelte';
  import Sensors from './Sensors.svelte';
  import AsyncFsm from './AsyncFsm.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Runed Utilities"
  description="Runed is a Svelte 5 collection of reactive utilities built on runes. Because most of them read the DOM, timers, or device sensors, each card is its own mochi:hydrate island — the page renders on the server with default values, then Runed brings it to life on the client."
  {sources}
>
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
