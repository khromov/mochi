<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import EntityIsland from './EntityIsland.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);

  const name = 'friend';
</script>

<DemoPage
  title="HTML Entities in Props"
  description="Static string-literal props on a hydrated island can contain HTML entities (&amp;, &quot;, &lt;, &copy;). They decode to their characters before reaching the island — identically on the server and after hydration — so the SSR text and the hydrated text always match."
  {sources}
>
  <section class="intro">
    <p>
      The parent (server-only) passes literal HTML entities in <code>string="…"</code> attributes on a <code>mochi:hydrate</code> island. Svelte decodes them for the SSR render,
      and Mochi's preprocessor decodes the same value into the serialized props the client hydrates with — so the two never disagree. Watch the
      <strong>Rendered on</strong> line flip from <code>server</code> to <code>client</code> after hydration while every value stays the same.
    </p>
    <pre><code
        >{`<EntityIsland
  label="Tom &amp; Jerry"
  quote="She said &quot;hi&quot;"
  comparison="5 &lt; 10 &amp;&amp; 10 &gt; 5"
  copyright="&copy; 2026 Mochi"
  greeting="Hi &amp; welcome, {name}"
  mochi:hydrate
/>`}</code
      ></pre>
  </section>

  <EntityIsland
    label="Tom &amp; Jerry"
    quote="She said &quot;hi&quot;"
    comparison="5 &lt; 10 &amp;&amp; 10 &gt; 5"
    copyright="&copy; 2026 Mochi"
    greeting="Hi &amp; welcome, {name}"
    mochi:hydrate
  />
</DemoPage>

<style>
  .intro {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .intro p {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
  }

  .intro strong {
    color: var(--text);
  }

  code {
    font-family: var(--font-mono);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
  }

  pre {
    margin: 0;
    padding: 0.75rem 0.85rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow-x: auto;
    font-size: 0.85rem;
    line-height: 1.5;
  }

  pre code {
    background: transparent;
    border: none;
    padding: 0;
    color: var(--text);
  }
</style>
