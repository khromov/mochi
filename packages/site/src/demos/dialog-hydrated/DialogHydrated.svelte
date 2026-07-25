<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import ModalDialog from './ModalDialog.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Hydrated Dialog"
  description="The native <dialog> element inside a mochi:hydrate island. showModal() opens it in the browser's top layer, a <form method=&quot;dialog&quot;> closes it and sets returnValue, and the close event reads that value back."
  {sources}
>
  <p>
    <code>showModal()</code> is an imperative DOM call, so it needs JavaScript in the browser — the island is marked <code>mochi:hydrate</code>. The buttons inside sit in a
    <code>&lt;form method="dialog"&gt;</code>, which is how the browser closes the dialog and sets <code>returnValue</code> to the pressed button's <code>value</code> without any
    JavaScript of its own. Escape closes it too, and both paths fire <code>close</code>.
  </p>

  <ModalDialog mochi:hydrate />
</DemoPage>

<style>
  p {
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.55;
    margin-bottom: 1.25rem;
  }

  code {
    font-family: var(--font-mono);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
    font-weight: 500;
  }
</style>
