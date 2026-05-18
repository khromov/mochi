<script>
  import '@fontsource/jetbrains-mono';
  import './lobster.css';
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'FontLoading.svelte', path: './src/demos/font-loading/FontLoading.svelte' },
    { label: 'lobster.css', path: './src/demos/font-loading/lobster.css' },
    { label: 'routes.ts', path: './src/demos/font-loading/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
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
    <pre><code
        >{`@font-face {
  font-family: 'Lobster';
  src: url('./lobster.woff2') format('woff2');
}`}</code
      ></pre>
    <p>
      Import the CSS (<code>import './lobster.css'</code>). Bun's CSS bundler inlines the <code>.woff2</code> as a base64 data URI in the bundled CSS.
    </p>
    <p class="sample sample-display">The quick brown fox jumps over the lazy dog. 1234567890</p>
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
  pre {
    margin: 0.75rem 0;
  }
</style>
