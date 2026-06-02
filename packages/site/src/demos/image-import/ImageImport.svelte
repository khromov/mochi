<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import ImportedInIsland from './ImportedInIsland.svelte';
  import { loadSources } from '../../components/utils.ts';
  import mochiImage from '../../../images/mochi-1.jpg';

  const sources = await loadSources([
    { label: 'ImageImport.svelte', path: './src/demos/image-import/ImageImport.svelte' },
    { label: 'ImportedInIsland.svelte', path: './src/demos/image-import/ImportedInIsland.svelte' },
    { label: 'routes.ts', path: './src/demos/image-import/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);

  const importType = typeof mochiImage;
  const importValue = String(mochiImage).slice(0, 200);
</script>

<DemoPage
  title="Image Import"
  description="Import any image directly and Mochi's Bun bundler hashes the file, copies it to a served location, and resolves the import to a /_mochi/asset/ URL — the same URL on the server and in a hydrated island."
  {sources}
>
  <div class="result">
    <p>
      <code>import mochiImage from '../../../images/mochi-1.jpg'</code>
    </p>
    <dl>
      <dt>typeof import</dt>
      <dd><code>{importType}</code></dd>
      <dt>value</dt>
      <dd><code>{importValue}</code></dd>
    </dl>
    {#if importType === 'string'}
      <p>Rendered as <code>&lt;img src=&#123;mochiImage&#125;&gt;</code>:</p>
      <img src={mochiImage} alt="mochi" />
    {/if}
    <hr />
    <ImportedInIsland mochi:hydrate />
  </div>
</DemoPage>

<style>
  .result {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.5rem 1rem;
    margin: 0;
  }
  dt {
    font-weight: 600;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  img {
    max-width: 100%;
    border-radius: 8px;
  }
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.5rem 0;
    width: 100%;
  }
</style>
