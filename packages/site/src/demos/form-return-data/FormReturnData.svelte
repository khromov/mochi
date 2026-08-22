<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import RandomRoll from './RandomRoll.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await compiled(() => loadSources(files));
</script>

<DemoPage
  title="Using form return data"
  description={`You can return data from an action via success(...). With {@attach enhance(...)}, the JSON result updates the UI in place. Without it, the page re-renders and the component can read the value from getRequestContext().form.`}
  {sources}
>
  <p>
    A minimal action that returns a random number via <code>success({'{ value }'})</code>. The hydrated version updates the input reactively; the non-hydrated version re-renders
    the whole page and the component reads the value from <code>getRequestContext().form</code>.
  </p>
  <h3>With <code>{'{@attach enhance(...)}'}</code></h3>
  <RandomRoll label="The enhance attachment fills the input via fetch + JSON, no reload" mochi:hydrate />
  <h3>Plain HTML</h3>
  <RandomRoll label="Full HTML POST, page re-renders, RandomRoll reads the value from the request's form snapshot via !isHydratable() && isServer" />
</DemoPage>

<style>
  h3 {
    margin: 1.5rem 0 0.25rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  p {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
</style>
