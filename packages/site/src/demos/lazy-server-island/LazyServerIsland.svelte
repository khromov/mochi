<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import LazyServerDemo from './LazyServerDemo.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await compiled(() => loadSources(files));
</script>

<DemoPage
  title="Lazy Server Islands"
  description="Server islands marked with mochi:defer:visible only fetch their HTML when the wrapper scrolls into view, via an IntersectionObserver. Each island is fetched independently from /_mochi/island/... — open the Network panel and scroll to watch the requests fire on demand. The first island uses rootMargin to start fetching 200px before it enters the viewport."
  {sources}
>
  <p class="hint">Scroll down to trigger each fetch. The IntersectionObserver fires per-island.</p>

  <div class="stack">
    <div class="item">
      <h3>Island #1 — <code>rootMargin: '200px'</code></h3>
      <LazyServerDemo mochi:defer:visible={{ rootMargin: '200px' }} index={1}>
        <div class="island-loading">Loading server island<span class="dots"></span></div>
      </LazyServerDemo>
    </div>

    {#each [2, 3, 4, 5] as i (i)}
      <div class="spacer"></div>
      <div class="item">
        <h3>Island #{i}</h3>
        <LazyServerDemo mochi:defer:visible index={i}>
          <div class="island-loading">Loading server island<span class="dots"></span></div>
        </LazyServerDemo>
      </div>
    {/each}
  </div>
</DemoPage>

<style>
  .hint {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin: 0 0 1rem;
  }

  .stack {
    display: flex;
    flex-direction: column;
  }

  .item h3 {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-muted);
    margin: 0 0 0.5rem;
  }

  .item h3 code {
    font-size: 0.85em;
    background: var(--surface-muted);
    padding: 0.1em 0.4em;
    border-radius: 4px;
  }

  .spacer {
    height: 70vh;
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
