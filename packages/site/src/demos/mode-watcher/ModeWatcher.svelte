<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import ModeControls from './ModeControls.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { highlightCode } from '../../lib/highlight.server';
  import { files } from './files.ts';

  let { initialMode = null } = $props();

  const sources = await compiled(() => loadSources(files));

  const codeInstall = await highlightCode('bun add mode-watcher', 'bash');
  const codeUsage = await highlightCode(
    `import { ModeWatcher, toggleMode } from 'mode-watcher';

// Mount ModeWatcher once; it applies the mode to <html>.
// <ModeWatcher />
// <button onclick={toggleMode}>Toggle</button>`,
    'typescript',
  );
  const codeSsr = await highlightCode(
    `// routes.ts — read the cookie server-side, feed it to <ModeWatcher> as defaultMode
Mochi.page('./ModeWatcher.svelte', {
  serverProps: () => ({ initialMode: cookies.get('mochi-demo-theme') }),
});

// and set the class on <html> before the page is sent — so there's no flash:
export const handle = async ({ event, resolve }) => {
  const dark = getRequestContext().cookies.get('mochi-demo-theme') === 'dark';
  return resolve(event, dark
    ? { transformPage: ({ html }) => html.replace('<html lang="en">', '<html lang="en" class="dark">') }
    : undefined);
};

// island — mirror the mode back into the cookie whenever it changes (isomorphic cookies API)
$effect(() => {
  if (mode.current) cookies.set('mochi-demo-theme', mode.current, { expires: 365 });
});`,
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
      <code>data-theme</code> attribute, so the two coexist without collision.
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
    <ModeControls {initialMode} mochi:hydrate />
  </section>

  <section class="card">
    <header>
      <h2>SSR-friendly theme, no flash</h2>
      <p>
        mode-watcher only persists to <code>localStorage</code>, which the server can't read — so on its own the first paint can flash. The bar above fixes that: the island mirrors
        the resolved mode into a cookie, <code>serverProps</code>
        reads it back into <code>&lt;ModeWatcher defaultMode&gt;</code>, and a <code>transformPage</code> hook stamps
        <code>class="dark"</code> onto <code>&lt;html&gt;</code> before the response is sent. Pick a mode, then reload — the page comes back correct with no flicker (<code
          >server sent:</code
        >
        shows the value the server used).
        <code>"system"</code> can't be server-resolved without JS, so the cookie stores the resolved
        <code>light</code>/<code>dark</code>.
      </p>
    </header>
    <CodeSnippet html={codeSsr} />
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
