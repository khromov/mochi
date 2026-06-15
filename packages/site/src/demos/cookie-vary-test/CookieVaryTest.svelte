<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Cookie Vary Test"
  description="This page sets Vary: Cookie on every response. The page cache sees this header and emits a s-vary-cookie skip — it refuses to cache the response unless the matching rule explicitly opts in via varyOnCookies."
  {sources}
>
  <p>Check the response headers: <code>Vary: Cookie</code> is set by the route handle.</p>
</DemoPage>
