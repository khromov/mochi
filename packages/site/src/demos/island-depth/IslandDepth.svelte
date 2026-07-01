<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import DepthLevel1 from './DepthLevel1.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Island Depth"
  description="Server islands can nest to any depth: each mochi:defer island's HTML is fetched on demand, and when it arrives it may contain further mochi:defer islands that fetch in turn. This chain goes four levels deep — level 1 fetches level 2, which fetches level 3, which fetches level 4. The prebuild precompiles every level into the manifest (Mochi discovers the whole chain eagerly at build time), so no level compiles on a request path in production. The maxIslandDepth option in Mochi.serve() caps how deep the build will follow the chain as a safety guard."
  {sources}
>
  <p class="delay-note">Each level is delayed on purpose to show the loading state as the chain fetches.</p>

  <DepthLevel1 mochi:defer>
    <div class="island-loading">Loading level 1<span class="dots"></span></div>
  </DepthLevel1>
</DemoPage>

<style>
  .delay-note {
    margin-bottom: 0.75rem;
    color: var(--text-subtle);
    font-size: 0.9rem;
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
