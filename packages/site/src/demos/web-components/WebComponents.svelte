<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import WebComponentsIsland from './WebComponentsIsland.svelte';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Web Components"
  description="Custom elements work in Mochi. Register them inside a hydratable island with importWebComponent() — both local elements and ones from npm. Mochi rewrites the call to a no-op on the server (so the browser-only definition module never loads during SSR) and to a dynamic import on the client (so customElements.define() runs on hydration). The tags render server-side with fallback text and upgrade in place. Registration is global, so the elements would upgrade anywhere on the page once defined."
  {sources}
>
  <WebComponentsIsland mochi:hydrate />
</DemoPage>
