<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import ApiTester from './ApiTester.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'Api.svelte', path: './src/demos/api/Api.svelte' },
    { label: 'ApiTester.svelte', path: './src/demos/api/ApiTester.svelte' },
    { label: 'routes.ts', path: './src/demos/api/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage title="API Endpoints" description="You can build JSON routes with Mochi.api()." {sources}>
  <ApiTester mochi:hydrate />
</DemoPage>
