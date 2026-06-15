<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import FileUpload from './FileUpload.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="File Uploads via form actions"
  description={`You can uploads files similarly to how other forms are handled. In the demo below where you can upload a text or markdown file, with {@attach enhance(...)}, the demo file content you upload is echoed back to you. Without progressive enhancement, the page re-renders and the component reads the result from getRequestContext().form.`}
  {sources}
>
  <h3>With <code>{'{@attach enhance(...)}'}</code></h3>
  <FileUpload label="The enhance attachment submits multipart/form-data over fetch and shows the file content inline" mochi:hydrate />
  <h3>Plain HTML</h3>
  <FileUpload label="Plain multipart POST, page re-renders with the file content from the form snapshot" />
</DemoPage>

<style>
  h3 {
    margin: 1.5rem 0 0.25rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
</style>
