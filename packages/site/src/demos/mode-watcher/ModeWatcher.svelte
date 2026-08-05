<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import ModeControls from './ModeControls.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { highlightCode } from '../../lib/highlight.server';
  import { files } from './files.ts';

  const sources = await loadSources(files);

  const codeInstall = await highlightCode('bun add mode-watcher', 'bash');
  const codeUsage = await highlightCode(
    `import { ModeWatcher, toggleMode } from 'mode-watcher';

// Mount ModeWatcher once; it applies the mode to <html>.
// <ModeWatcher />
// <button onclick={toggleMode}>Toggle</button>`,
    'typescript',
  );
</script>

<DemoPage
  title="Mode Watcher"
  description="mode-watcher manages light/dark mode by mutating the global <html> element. Because it reads the DOM and localStorage, the whole thing lives in a mochi:hydrate island — the page renders on the server, then mode-watcher takes over on the client."
  {sources}
>
  <div class="intro">
    <p>
      <code>mode-watcher</code> needs a little setup: you mount its <code>&lt;ModeWatcher /&gt;</code> component once, and it reads <code>localStorage</code> and applies the mode
      to the global <code>&lt;html&gt;</code> element — adding a
      <code>dark</code> class and setting <code>color-scheme</code>. This site drives its own theme off a
      <code>data-theme</code> attribute, so the two coexist; leaving this page clears the stored preference so the rest of the site stays on its own theme.
    </p>
    <CodeSnippet html={codeInstall} />
    <p>Mount it once, then any button can drive the mode:</p>
    <CodeSnippet html={codeUsage} />
    <p>
      Full API at <a href="https://mode-watcher.dev" target="_blank" rel="noopener noreferrer">mode-watcher.dev</a>.
    </p>
  </div>

  <section class="card">
    <header>
      <h2>Toggle &amp; set the mode</h2>
      <p>
        <code>toggleMode</code>, <code>setMode</code>, and <code>resetMode</code> drive the global theme; the
        <code>mode</code>, <code>userPrefersMode</code>, and <code>systemPrefersMode</code> runes report the current state.
      </p>
    </header>
    <ModeControls mochi:hydrate />
  </section>
</DemoPage>

<style>
  .intro {
    font-size: 0.95rem;
    color: var(--text-muted);
    margin: 0 0 1.75rem;
  }

  .intro p {
    margin: 0 0 0.75rem;
  }

  .intro a {
    color: var(--accent);
    text-decoration: underline;
  }

  .intro > p:last-child {
    margin-bottom: 0;
  }

  .intro p code {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
  }

  .card {
    margin-bottom: 2rem;
  }

  .card header {
    margin-bottom: 0.9rem;
  }

  .card header p {
    font-size: 0.95rem;
    color: var(--text-muted);
    margin: 0.25rem 0 0;
  }

  .card header code {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
  }
</style>
