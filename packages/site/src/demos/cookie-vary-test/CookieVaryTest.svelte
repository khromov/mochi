<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'CookieVaryTest.svelte', path: './src/demos/cookie-vary-test/CookieVaryTest.svelte' },
    { label: 'routes.ts', path: './src/demos/cookie-vary-test/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Cookie Vary Test"
  description="This page sets Vary: Cookie on every response. The page cache sees this header and emits a s-vary-cookie skip — it refuses to cache the response unless the matching rule explicitly opts in via varyOnCookies."
  {sources}
>
  <p>Check the response headers: <code>Vary: Cookie</code> is set by the route handle.</p>
</DemoPage>
