<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import BasicTable from './BasicTable.svelte';
  import SortableTable from './SortableTable.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { highlightCode } from '../../lib/highlight.server';
  import { files } from './files.ts';

  const sources = await compiled(() => loadSources(files));

  const codeInstall = await highlightCode('bun add @tanstack/svelte-table', 'bash');
  const codeUsage = await highlightCode(
    `import { createTable, FlexRender, tableFeatures } from '@tanstack/svelte-table';

const table = createTable({
  features: tableFeatures({}), // opt into features (sorting, filtering…) as you need them
  columns,
  get data() {
    return people; // a getter keeps the table in sync with your $state
  },
});
// then render table.getHeaderGroups() / table.getRowModel() with <FlexRender />`,
    'typescript',
  );
</script>

<DemoPage
  title="Tables with TanStack Table"
  description="TanStack Table is a headless table library. A read-only table renders entirely on the server and ships zero JavaScript; interactive features like sorting opt into a mochi:hydrate island."
  {sources}
>
  <div class="intro">
    <p>
      TanStack Table needs no special setup — it's a headless, framework-agnostic table library with a Svelte 5 runes adapter. You install it and import from <code
        >@tanstack/svelte-table</code
      >; in Mochi it bundles straight into whichever island imports it.
    </p>
    <CodeSnippet html={codeInstall} />
    <p>
      Declare which features you need with <code>tableFeatures</code>, pass your <code>columns</code> and
      <code>data</code>, then render the header/cell definitions with <code>&lt;FlexRender /&gt;</code>:
    </p>
    <CodeSnippet html={codeUsage} />
    <p>
      Full API at <a href="https://tanstack.com/table" target="_blank" rel="noopener noreferrer">tanstack.com/table</a>.
    </p>
  </div>

  <section class="card">
    <header>
      <h2>Read-only table — server-rendered, zero JS</h2>
      <p>
        The whole table is plain server HTML: no <code>mochi:hydrate</code>, so nothing ships to the browser. This only makes sense when you don't need sorting, filtering, or any
        client interaction — otherwise reach for an island.
      </p>
    </header>
    <BasicTable />
  </section>

  <section class="card">
    <header>
      <h2>Sortable table — <code>mochi:hydrate</code></h2>
      <p>
        Registering <code>rowSortingFeature</code> makes the headers clickable — cycle ascending → descending → unsorted. Sorting runs on the client, so this card is a hydrated island.
      </p>
    </header>
    <SortableTable mochi:hydrate />
  </section>
</DemoPage>

<style>
  .intro {
    font-size: 0.95rem;
    color: var(--text-muted);
    margin: 0 0 1.75rem;
  }

  .intro p {
    margin: 0 0 0.75rem;
  }

  .intro a {
    color: var(--accent);
    text-decoration: underline;
  }

  .intro > p:last-child {
    margin-bottom: 0;
  }

  .intro p code {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
  }

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
