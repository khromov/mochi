<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import ErrorDemo from './ErrorDemo.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Form Errors"
  description={`Both standard HTML forms and progressively enhanced forms can handle errors gracefully. With {@attach enhance(...)}, the error message is shown inline. Without it, Mochi renders the server error page.`}
  {sources}
>
  <p>
    The action throws a plain <code>Error</code>. With <code>{'{@attach enhance(...)}'}</code> the error message is shown inline. Without it, the server renders the Mochi error page.
  </p>
  <h3>With <code>{'{@attach enhance(...)}'}</code></h3>
  <ErrorDemo label="The enhance attachment catches the thrown error and shows it inline" mochi:hydrate />
  <h3>Plain HTML</h3>
  <ErrorDemo label="Plain POST, server throws, Mochi renders the error page (press back to return)" />
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
