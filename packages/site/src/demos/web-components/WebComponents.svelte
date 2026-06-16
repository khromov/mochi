<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import WebComponentsIsland from './WebComponentsIsland.svelte';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Web Components"
  description="Custom elements work in Mochi. They need client-side JS to register, so import them inside a hydratable island — both local elements and ones from npm. The island's bundle runs customElements.define() on hydration, and the tags (server-rendered with fallback text) upgrade in place. Registration is global, so the elements would upgrade anywhere on the page once defined."
  {sources}
>
  <WebComponentsIsland mochi:hydrate />
</DemoPage>
