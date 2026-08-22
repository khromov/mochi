<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import ApiTester from './ApiTester.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage title="API Endpoints" description="You can build JSON routes with Mochi.api()." {sources}>
  <ApiTester mochi:hydrate />
</DemoPage>
