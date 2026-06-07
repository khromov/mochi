<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import FileViewer from './FileViewer.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'File.svelte', path: './src/demos/file/File.svelte' },
    { label: 'FileViewer.svelte', path: './src/demos/file/FileViewer.svelte' },
    { label: 'routes.ts', path: './src/demos/file/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="File Routes"
  description="You can serve a file straight from disk with Mochi.file() — pass a static path, or a resolver that picks the file per request from the route params. Missing files (or a resolver that throws error(404)) come back as a plain-text 404."
  {sources}
>
  <FileViewer mochi:hydrate />
</DemoPage>
