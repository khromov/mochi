<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import Controls from './Controls.svelte';
  import ServerClock from './ServerClock.svelte';
  import LiveCounter from './LiveCounter.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Defer Invalidation"
  description="Give a mochi:defer island a name, then call reloadDeferredIsland(name) from the browser to re-fetch its server HTML — the promise resolves once every matching island has swapped in. reloadDeferredIslandAll() reloads them all. Islands sharing a name reload together, and a hydrated defer re-hydrates after each reload. The buttons live in a mochi:hydrate island and bump a Svelte $state store so the reload count stays live."
  {sources}
>
  <Controls mochi:hydrate />

  <ServerClock mochi:defer={{ name: 'single' }} label="single">
    <div class="island-loading">Loading<span class="dots"></span></div>
  </ServerClock>

  <div class="spacer"></div>

  <div class="pair">
    <ServerClock mochi:defer={{ name: 'pair' }} label="pair a">
      <div class="island-loading">Loading<span class="dots"></span></div>
    </ServerClock>
    <ServerClock mochi:defer={{ name: 'pair' }} label="pair b">
      <div class="island-loading">Loading<span class="dots"></span></div>
    </ServerClock>
  </div>

  <div class="spacer"></div>

  <LiveCounter mochi:defer={{ name: 'live' }} mochi:hydrate>
    <div class="island-loading tall">Loading<span class="dots"></span></div>
  </LiveCounter>
</DemoPage>

<style>
  .pair {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .spacer {
    height: 0.75rem;
  }

  /* Matches the loaded content's box so swapping between them shifts nothing. */
  .island-loading {
    display: flex;
    align-items: center;
    min-height: 3.5rem;
    padding: 0.9rem 1rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text-subtle);
    font-size: 0.9rem;
    font-style: italic;
  }

  .island-loading.tall {
    min-height: 4.8rem;
  }

  /* The wrapper is display:contents, so it has no box of its own to style — the child gets it. */
  :global(mochi-server-island[data-reloading] > *) {
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(mochi-server-island[data-reloading] > *) {
      animation: none;
      opacity: 0.6;
    }
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
