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
  title="Invalidate mochi:defer islands"
  description="Give a mochi:defer island a name, then call reloadDeferredIsland(name) from the browser to re-fetch its server HTML. Island 1 is also hydrated, so it unmounts and re-hydrates on every reload — its counter resets. Islands 2 and 3 share the name 2-and-3, so they reload together. While an island reloads it shows its fallback again and carries data-reloading; the status line and the counter below are driven entirely by the mochi:island:reload* events, not by the code that clicked the button."
  {sources}
>
  <Controls mochi:hydrate />

  <LiveCounter mochi:defer={{ name: '1' }} mochi:hydrate label="1">
    <div class="island-loading tall">Loading<span class="dots"></span></div>
  </LiveCounter>

  <div class="spacer"></div>

  <div class="pair">
    <ServerClock mochi:defer={{ name: '2-and-3' }} label="2">
      <div class="island-loading">Loading<span class="dots"></span></div>
    </ServerClock>
    <ServerClock mochi:defer={{ name: '2-and-3' }} label="3">
      <div class="island-loading">Loading<span class="dots"></span></div>
    </ServerClock>
  </div>
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
