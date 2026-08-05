<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import DepthLevel1 from './DepthLevel1.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Nested Island Max Depth"
  description={"Server islands can nest to any depth, and by default Mochi inlines nested mochi:defer islands into their parent's fetch: one request returns the whole four-level chain, rendered in a single server pass. Opt out per call site with mochi:defer={{ inline: false }} to keep each level on its own fetch — its HTML then arrives with a placeholder that fetches the next level in turn, useful when a slow child shouldn't delay the parent's content. The flag is threaded down every level here, since an opt-out only applies to the call site it's written on. Either way the prebuild precompiles every level into the manifest in a single pass, so no level compiles on a request path in production."}
  {sources}
>
  <p class="delay-note">
    Each level is delayed on purpose — and twice as long in the opted-out chain, so the loading pattern is easy to follow. The opted-out chain fetches level by level; the inlined
    chain makes one fetch that takes roughly the sum of its delays.
  </p>

  <div class="chains">
    <section>
      <h3>Opted out — waterfall <code>{'{{ inline: false }}'}</code></h3>
      <DepthLevel1 mochi:defer={{ inline: false }} inline={false}>
        <div class="island-loading">Loading level 1<span class="dots"></span></div>
      </DepthLevel1>
    </section>
    <section>
      <h3>Inlined — one fetch <code>{'{{ inline: true }}'}</code></h3>
      <DepthLevel1 mochi:defer={{ inline: true }} inline={true}>
        <div class="island-loading">Loading levels 1–4<span class="dots"></span></div>
      </DepthLevel1>
    </section>
  </div>
</DemoPage>

<style>
  .delay-note {
    margin-bottom: 0.75rem;
    color: var(--text-subtle);
    font-size: 0.9rem;
  }

  .chains {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1rem;
    align-items: start;
  }

  .chains h3 {
    margin: 0 0 0.6rem;
    font-size: 1rem;
  }

  .chains code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    color: var(--text-subtle);
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
