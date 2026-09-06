<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import Callout from '../../../../docs/_components/Callout.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { highlightCode } from '../../lib/highlight.server';
  import { files } from './files.ts';
  import { playgroundJson } from './blocks.ts';
  import Playground from './Playground.svelte';

  const sv = (code: string) => highlightCode(code, 'svelte');
  const ts = (code: string) => highlightCode(code, 'typescript');

  const codeInstall = await highlightCode('bun add @portabletext/svelte', 'bash');
  const codeImport = await ts("import { PortableText } from '@portabletext/svelte';");
  const codeBasic = await sv('<PortableText value={blocks} />');
  const codePair = await sv('<Playground source={playgroundJson} />\n<Playground mochi:hydrate source={playgroundJson} />');

  const sources = await compiled(() => loadSources(files));
</script>

<DemoPage
  title="Portable Text"
  description="@portabletext/svelte renders Portable Text — the JSON format editors like Sanity emit for rich text — by mapping each block, mark, style and list onto a Svelte component you own."
  {sources}
>
  <p>
    Portable Text stores rich text as an array of JSON blocks instead of HTML, so the same content can render to a web page, a PDF or a native app. <a
      href="https://github.com/portabletext/svelte-portabletext"
      target="_blank"
      rel="noopener noreferrer">@portabletext/svelte</a
    >
    is the official Svelte 5 renderer for it; the format itself is documented at
    <a href="https://portabletext.org" target="_blank" rel="noopener noreferrer">portabletext.org</a>. Everything on this page is server-rendered by Mochi except the last section.
  </p>

  <h3>Install</h3>
  <CodeSnippet html={codeInstall} />
  <CodeSnippet html={codeImport} />
  <CodeSnippet html={codeBasic} />

  <h3>The same renderer, hydrated and not</h3>
  <p>
    Both panels below are the same component rendered from the same JSON. The left one is plain SSR markup; the right one carries <code>mochi:hydrate</code>, so the renderer ships
    to the browser and re-runs on every keystroke.
  </p>
  <div class="pair">
    <Playground source={playgroundJson} />
    <Playground mochi:hydrate source={playgroundJson} />
  </div>
  <CodeSnippet html={codePair} />
  <Callout type="info">
    Hydration is all-or-nothing per island: the right panel ships <code>@portabletext/svelte</code> plus every component it references, and its props are serialized in plain text into
    the page. The left panel ships nothing.
  </Callout>
</DemoPage>

<style>
  p code,
  h3 code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  @media (max-width: 720px) {
    .pair {
      grid-template-columns: 1fr;
    }
  }
</style>
