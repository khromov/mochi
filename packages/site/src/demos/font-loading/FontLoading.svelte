<script>
  import '@fontsource/jetbrains-mono';
  import './lobster.css';
  import '@fontsource-variable/caveat' with { subset: "It's animated!", weight: '500', layoutClosure: 'none' };
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import { sources } from './sources.prerender.ts';
  import { highlightCode } from '../../lib/highlight.server';

  const codeFontFace = await highlightCode(
    `@font-face {
  font-family: 'Lobster';
  src: url('./lobster.woff2') format('woff2');
}`,
    'css',
  );
  const codeSubset = await highlightCode(`import '@fontsource-variable/caveat' with { subset: "It's animated!", weight: '500', layoutClosure: 'none' };`, 'ts');
</script>

<DemoPage
  title="Font loading"
  description="Mochi supports loading fonts from third-party packages like @fontsource or from local font files like .woff2 — all automatically bundled and linked from the page <head>."
  {sources}
>
  <section>
    <h2>Fontsource package example</h2>
    <p>
      Add <code>@fontsource/jetbrains-mono</code> and import it.
    </p>
    <p class="sample sample-mono">The quick brown fox jumps over the lazy dog. 1234567890</p>
  </section>

  <section>
    <h2>Standalone .woff2 example</h2>
    <p>
      Drop a <code>.woff2</code> next to your component and reference it from a tiny
      <code>@font-face</code> CSS file:
    </p>
    <CodeSnippet html={codeFontFace} />
    <p>
      Import the CSS (<code>import './lobster.css'</code>). Mochi serves the <code>.woff2</code> as a separate content-hashed file — small fonts (≤4&nbsp;kB) stay inlined in the bundled
      CSS as data URIs.
    </p>
    <p class="sample sample-display">The quick brown fox jumps over the lazy dog. 1234567890</p>
  </section>

  <section>
    <h2>Subsetting example</h2>
    <p>Name the text on the import and Mochi keeps only those glyphs:</p>
    <CodeSnippet html={codeSubset} />
    <p>
      Caveat's 75&nbsp;kB latin file becomes 2.4&nbsp;kB here: pinned to weight 500 and without layout closure, it is small enough to inline, so this page makes no request for it.
      Change the string to change the glyphs; in dev, a character the subset lacks is reported in the console.
    </p>
    <p class="sample sample-note">It's animated!</p>
  </section>
</DemoPage>

<style>
  section {
    margin: 2rem 0;
  }
  h2 {
    margin-bottom: 0.5rem;
    font-family: var(--font-serif);
  }
  .sample {
    margin-top: 1rem;
    padding: 1.25rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: 1.5rem;
  }
  .sample-mono {
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  }
  .sample-display {
    font-family: 'Lobster', cursive;
    font-size: 2rem;
  }
  .sample-note {
    font-family: 'Caveat Variable', cursive;
    font-weight: 500;
    font-size: 2.25rem;
  }
</style>
