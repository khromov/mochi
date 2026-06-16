<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import WebComponentsIsland from './WebComponentsIsland.svelte';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Web Components"
  description="Custom elements work in Mochi. Import them inside a hydratable island with plain imports — both local elements and ones from npm. Mochi's server-side shims let the definition modules import during SSR, so the tags render server-side (with fallback text) and upgrade in place once the island's bundle runs customElements.define() on hydration. Registration is global, so the elements would upgrade anywhere on the page once defined."
  {sources}
>
  <WebComponentsIsland mochi:hydrate />
</DemoPage>
