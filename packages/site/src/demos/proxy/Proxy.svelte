<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import ProxyTester from './ProxyTester.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Reverse proxy"
  description="Mochi.proxy() forwards /demos/proxy/up/* to a separate in-process upstream server, stripping the mount prefix before forwarding. The upstream echoes back the path it actually received."
  {sources}
>
  <ProxyTester mochi:hydrate />
</DemoPage>
