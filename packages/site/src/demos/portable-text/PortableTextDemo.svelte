<script lang="ts">
  import { PortableText, toPlainText } from '@portabletext/svelte';
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import Callout from '../../../../docs/_components/Callout.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { highlightCode } from '../../lib/highlight.server';
  import { files } from './files.ts';
  import { annotated, basics, checklist, collectFootnotes, customMarks, customStyles, customTypes, playgroundJson } from './blocks.ts';
  import AbsoluteUrl from './AbsoluteUrl.svelte';
  import CalloutBlock from './CalloutBlock.svelte';
  import Checklist from './Checklist.svelte';
  import ChecklistItem from './ChecklistItem.svelte';
  import CustomHeading from './CustomHeading.svelte';
  import Footnote from './Footnote.svelte';
  import Highlight from './Highlight.svelte';
  import MissingTypes from './MissingTypes.svelte';
  import Playground from './Playground.svelte';

  const footnotes = collectFootnotes(annotated);

  const sv = (code: string) => highlightCode(code, 'svelte');
  const ts = (code: string) => highlightCode(code, 'typescript');
  const json = (code: string) => highlightCode(code, 'json');

  const codeInstall = await highlightCode('bun add @portabletext/svelte', 'bash');
  const codeImport = await ts("import { PortableText } from '@portabletext/svelte';");
  const codeBasic = await sv('<PortableText value={blocks} />');
  const codeTypes = await sv('<PortableText value={blocks} components={{ types: { callout: CalloutBlock } }} />');
  const codeTypesProps = await ts('let { portableText }: { portableText: CustomBlockComponentProps<Callout> } = $props();\nlet { value, isInline } = $derived(portableText);');
  const codeMarksJson = await json('{ "_type": "absUrl", "_key": "cm1a1", "url": "https://portabletext.org", "newWindow": true }');
  const codeMarks = await sv('<PortableText value={blocks} components={{ marks: { absUrl: AbsoluteUrl, highlight: Highlight } }} />');
  const codeBlock = await sv('<PortableText value={blocks} components={{ block: { h2: CustomHeading, h3: CustomHeading } }} />');
  const codeBlockProps = await ts(
    "let { indexInParent, global, value } = $derived(portableText);\nlet previous = $derived(global.ptBlocks[indexInParent - 1]);\nlet precededByHeading = $derived(['h1', 'h2', 'h3'].includes(previous?.style ?? ''));",
  );
  const codeListJson = await json('{ "_type": "block", "_key": "cl1", "listItem": "checklist", "level": 1, "checked": true, "children": [] }');
  const codeList = await sv('<PortableText\n  value={blocks}\n  components={{ list: { checklist: Checklist }, listItem: ChecklistItem }}\n/>');
  const codeContext = await sv('<PortableText\n  value={blocks}\n  components={{ marks: { footnote: Footnote } }}\n  context={{ footnotes }}\n/>');
  const codeContextRead = await ts(
    'let { footnotes } = $derived(portableText.global.context);\nlet number = $derived(footnotes.findIndex((note) => note._key === portableText.value._key) + 1);',
  );
  const codePlainText = await ts("import { toPlainText } from '@portabletext/svelte';\n\nconst description = toPlainText(blocks);");
  const codeMissing = await sv(
    '<PortableText value={blocks} />\n<PortableText value={blocks} onMissingComponent={false} />\n<PortableText value={blocks} onMissingComponent={(message, { type, nodeType }) => collect(message)} />',
  );
  const codePair = await sv('<Playground source={playgroundJson} />\n<Playground mochi:hydrate source={playgroundJson} />');

  const sources = await loadSources(files);
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
    <a href="https://portabletext.org" target="_blank" rel="noopener noreferrer">portabletext.org</a>. Everything on this page is server-rendered by Mochi except the last two
    sections.
  </p>

  <h3>Install</h3>
  <CodeSnippet html={codeInstall} />
  <CodeSnippet html={codeImport} />
  <CodeSnippet html={codeBasic} />

  <h3>Default rendering</h3>
  <p>Headings, paragraphs, blockquotes, lists and the standard decorators need no components at all.</p>
  <div class="pt-frame">
    <PortableText value={basics} />
  </div>

  <h3>Custom block types — <code>components.types</code></h3>
  <p>
    Anything whose <code>_type</code> isn't <code>block</code> is yours to render. The same component handles the type wherever it appears; <code>isInline</code>
    tells it whether it sits between spans or on its own.
  </p>
  <div class="pt-frame">
    <PortableText value={customTypes} components={{ types: { callout: CalloutBlock } }} />
  </div>
  <CodeSnippet html={codeTypes} />
  <CodeSnippet html={codeTypesProps} />

  <h3>Custom marks — <code>components.marks</code></h3>
  <p>
    Marks come in two flavours. An <em>annotation</em> is listed in the block's <code>markDefs</code> and its data arrives as
    <code>portableText.value</code>; a <em>decorator</em> is a bare string like <code>strong</code> and has no data.
  </p>
  <CodeSnippet html={codeMarksJson} />
  <div class="pt-frame">
    <PortableText value={customMarks} components={{ marks: { absUrl: AbsoluteUrl, highlight: Highlight } }} />
  </div>
  <CodeSnippet html={codeMarks} />

  <h3>Custom block styles — <code>components.block</code></h3>
  <p>
    A block component sees its own index and the whole normalized array, so it can style itself against its neighbours — here a heading that follows another heading tucks up
    closer.
  </p>
  <div class="pt-frame">
    <PortableText value={customStyles} components={{ block: { h2: CustomHeading, h3: CustomHeading } }} />
  </div>
  <CodeSnippet html={codeBlock} />
  <CodeSnippet html={codeBlockProps} />

  <h3>Custom lists — <code>components.list</code> and <code>components.listItem</code></h3>
  <p>
    There is no list node in the format: consecutive blocks sharing a <code>listItem</code> and <code>level</code> are grouped into a virtual one, so a made-up list type only needs a
    wrapper and an item component.
  </p>
  <CodeSnippet html={codeListJson} />
  <div class="pt-frame">
    <PortableText value={checklist} components={{ list: { checklist: Checklist }, listItem: ChecklistItem }} />
  </div>
  <CodeSnippet html={codeList} />
  <Callout type="warning">
    <code>list</code> takes a record keyed by list type, but in 3.0.1 <code>listItem</code>'s record form is keyed by the block's <code>style</code> rather than its
    <code>listItem</code>, so it never matches a plain list item. Passing a single component — the other form the API accepts — handles every item style and works today.
  </Callout>

  <h3>Shared data — <code>context</code></h3>
  <p>
    Everything passed as <code>context</code> reaches every component through <code>portableText.global.context</code>. Footnotes are the classic case: editors write only the note
    body, and the front-end decides the numbering and where it lands.
  </p>
  <div class="pt-frame">
    <PortableText value={annotated} components={{ marks: { footnote: Footnote } }} context={{ footnotes }} />
    <ol class="notes">
      {#each footnotes as note (note._key)}
        <li id="note-{note._key}">
          <PortableText value={note.note} />
          <a class="back" href="#src-{note._key}" aria-label="Back to the reference">↩</a>
        </li>
      {/each}
    </ol>
  </div>
  <CodeSnippet html={codeContext} />
  <CodeSnippet html={codeContextRead} />

  <h3><code>toPlainText()</code></h3>
  <p>Flattens blocks to a string — what you want for a meta description or a search index.</p>
  <pre class="plain">{toPlainText(basics)}</pre>
  <CodeSnippet html={codePlainText} />

  <h3>Unknown types — <code>onMissingComponent</code></h3>
  <p>
    Nothing throws when a type has no component: the content still renders, and the renderer reports what it couldn't map. Pass <code>false</code> to silence it or a function to route
    it into your own logger.
  </p>
  <Callout type="info">
    The renderer reports missing components from an <code>$effect</code>, which doesn't run during SSR — so this panel is hydrated. Server-side the same value renders silently.
  </Callout>
  <MissingTypes mochi:hydrate />
  <CodeSnippet html={codeMissing} />

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
  .pt-frame {
    padding: 0.6rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    line-height: 1.6;
  }

  .pt-frame :global(p) {
    margin: 0.6rem 0;
    color: var(--text-muted);
  }

  .pt-frame :global(h2),
  .pt-frame :global(h3) {
    font-family: var(--font-serif);
    font-weight: 500;
  }

  .pt-frame :global(blockquote) {
    margin: 0.6rem 0;
    padding: 0.4rem 0.8rem;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  .pt-frame :global(ul),
  .pt-frame :global(ol) {
    margin: 0.6rem 0;
    padding-left: 1.4rem;
    color: var(--text-muted);
  }

  .pt-frame :global(a) {
    color: var(--accent);
  }

  .notes {
    margin-top: 0.8rem;
    padding-top: 0.6rem;
    border-top: 1px dashed var(--border);
    font-size: 0.85rem;
  }

  .notes :global(p) {
    display: inline;
  }

  .back {
    margin-left: 0.3rem;
    text-decoration: none;
  }

  .plain {
    margin: 0.5rem 0 0.75rem;
    padding: 0.6rem 0.85rem;
    border-radius: var(--radius-sm);
    background: var(--code-bg);
    color: var(--code-text);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  p code,
  h3 code,
  .pt-frame :global(code) {
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
