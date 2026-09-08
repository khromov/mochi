<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import ApiTester from './ApiTester.svelte';
  import { sources } from './sources.compiled.ts';
</script>

<DemoPage title="API Endpoints" description="You can build JSON routes with Mochi.api()." {sources}>
  <ApiTester mochi:hydrate />
</DemoPage>
