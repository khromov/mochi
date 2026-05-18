<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'HelloWorld.svelte', path: './src/demos/hello-world/HelloWorld.svelte' },
    { label: 'routes.ts', path: './src/demos/hello-world/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage title="Hello World" description="The simplest possible Mochi page — a Svelte component rendered on the server with no client-side JavaScript." {sources}>
  <p>Hello, world!</p>
</DemoPage>
