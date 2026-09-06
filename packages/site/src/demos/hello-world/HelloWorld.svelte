<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await compiled(() => loadSources(files));
</script>

<DemoPage title="Hello World" description="The simplest possible Mochi page — a Svelte component rendered on the server with no client-side JavaScript." {sources}>
  <p>Hello, world!</p>
</DemoPage>
