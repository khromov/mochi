<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import DeferWithHydrators from './DeferWithHydrators.svelte';
  import DeferNest from './DeferNest.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Nested Islands"
  description="Server islands can contain other islands. The first example is a mochi:defer server island wrapping several mochi:hydrate components — the deferred fetch delivers them, then each counter hydrates on its own. The second nests two more islands inside a mochi:defer server island: another mochi:defer server island and a mochi:defer mochi:hydrate one. Open the debug bar (bottom toolbar) to see each island accounted for exactly once."
  {sources}
>
  <p class="delay-note">The islands below are delayed on purpose to show the loading state.</p>

  <h3>1. mochi:defer server island with mochi:hydrate components inside</h3>
  <DeferWithHydrators mochi:defer>
    <div class="island-loading">Loading server island<span class="dots"></span></div>
  </DeferWithHydrators>

  <div class="spacer"></div>

  <h3>2. mochi:defer server island nesting two more islands</h3>
  <DeferNest mochi:defer>
    <div class="island-loading">Loading server island<span class="dots"></span></div>
  </DeferNest>
</DemoPage>

<style>
  .delay-note {
    margin-bottom: 0.75rem;
    color: var(--text-subtle);
    font-size: 0.9rem;
  }

  h3 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
  }

  .spacer {
    height: 1.25rem;
  }

  .island-loading {
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
