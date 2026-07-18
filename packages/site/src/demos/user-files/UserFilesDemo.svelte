<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import { highlightCode } from '../../lib/highlight.server';

  let { entries, text } = $props();

  const ts = (code) => highlightCode(code, 'typescript');
  const codeConfig = await ts("localDirs: { 'user-files': './user-files' },");
  const codeList = await ts("const f = await localFile('user-files/hello.txt');\n// f → { url: '/_mochi/files/user-files/hello.txt', size, contentType, lastModified }");
  const codeBytes = await ts("const bytes = await localFileBytes('user-files/hello.txt');\nconst text = new TextDecoder().decode(bytes);");

  const name = (url) => decodeURIComponent(url.split('/').pop());
  const date = (ms) => new Date(ms).toISOString().slice(0, 10);

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Serving user-uploaded files"
  description="Serve any file type from a runtime folder with localDirs. The files below are pre-existing samples in ./user-files/ — in a real app an upload handler would Bun.write into the folder, and each file is addressable at its /_mochi/files/… URL the moment it exists. There is no upload form here; nothing on this page can write to the server."
  {sources}
>
  <h3>Declare the folder</h3>
  <p>
    A <code>localDirs</code> entry makes a folder's contents servable at runtime — any file type, with <code>Content-Type</code> derived from the extension, revalidating caching,
    and native <code>Range</code> support (audio/video seeking, resumable downloads). Dotfiles are refused unless the dir sets <code>includeDotfiles</code>:
  </p>
  <CodeSnippet html={codeConfig} />

  <h3>List files with <code>localFile</code></h3>
  <p><code>localFile('&lt;dir&gt;/&lt;path&gt;')</code> returns the served URL plus metadata — plain data, safe to pass as a page prop:</p>
  <CodeSnippet html={codeList} />
  <table>
    <thead>
      <tr><th>File</th><th>Type</th><th>Size</th><th>Modified</th></tr>
    </thead>
    <tbody>
      {#each entries as entry (entry.url)}
        <tr>
          <td><a href={entry.url} download>{name(entry.url)}</a></td>
          <td><code>{entry.contentType}</code></td>
          <td>{entry.size} B</td>
          <td>{date(entry.lastModified)}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <h3>Read content with <code>localFileBytes</code></h3>
  <p>The same guarded resolution, returning the raw bytes — here decoding <code>hello.txt</code> during SSR:</p>
  <CodeSnippet html={codeBytes} />
  <pre class="content">{text}</pre>
</DemoPage>

<style>
  h3 {
    margin-top: 1.5rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.9rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border, #333);
  }
  .content {
    font-size: 0.85rem;
    white-space: pre-wrap;
  }
</style>
