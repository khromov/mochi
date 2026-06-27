<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import FileViewer from './FileViewer.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="File Routes"
  description="You can serve a file straight from disk with Mochi.file() — pass a static path, or a resolver that picks the file per request from the route params. The file is read fresh on every request, so files written or deleted at runtime are picked up immediately. Missing files (or a resolver that throws error(404)) come back as a plain-text 404."
  {sources}
>
  <FileViewer mochi:hydrate />
</DemoPage>
