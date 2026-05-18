<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import Greeting from './Greeting.md';
  import Snippet from './Snippet.svx';

  const sources = await loadSources([
    { label: 'Greeting.md', path: './src/demos/mdsvex/Greeting.md', lang: 'svelte' },
    { label: 'Snippet.svx', path: './src/demos/mdsvex/Snippet.svx', lang: 'svelte' },
    { label: 'MdsvexDemo.svelte', path: './src/demos/mdsvex/MdsvexDemo.svelte' },
    { label: 'routes.ts', path: './src/demos/mdsvex/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="MdSvex"
  description="`.md` and `.svx` files compile through mdsvex into Svelte components — pass them anywhere a `.svelte` component is accepted, or import them as children."
  {sources}
>
  <div class="mdsvex-output">
    <Greeting name="Mochi" />
    <hr />
    <Snippet items={['Hydration', 'CSS imports', 'MdSvex']} />
  </div>
</DemoPage>

<style>
  .mdsvex-output {
    padding: 1rem 1.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    line-height: 1.6;
  }
  .mdsvex-output :global(h2),
  .mdsvex-output :global(h3) {
    margin: 0 0 0.5rem;
    font-family: var(--font-serif);
    font-weight: 500;
  }
  .mdsvex-output :global(p) {
    margin: 0 0 0.9rem;
    color: var(--text-muted);
  }
  .mdsvex-output :global(ul),
  .mdsvex-output :global(ol) {
    margin: 0 0 0.9rem;
    padding-left: 1.5rem;
    color: var(--text-muted);
  }
  .mdsvex-output :global(li) {
    margin-bottom: 0.2rem;
  }
  .mdsvex-output :global(blockquote) {
    margin: 0 0 0.9rem;
    padding: 0.5rem 0.9rem;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
  .mdsvex-output :global(blockquote p:last-child) {
    margin-bottom: 0;
    color: inherit;
  }
  .mdsvex-output :global(.code-block) {
    margin: 1rem 0 1.25rem;
  }
  .mdsvex-output :global(hr) {
    margin: 1.5rem 0;
    border: 0;
    border-top: 1px dashed var(--border-strong);
  }
</style>
