<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import Badge from '../../components/Badge.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { highlightCode } from '../../lib/highlight.server';
  import { files } from './files.ts';
  import type { VarlockConfig } from './env.ts';

  let { config }: { config: VarlockConfig } = $props();

  const sources = await loadSources(files);

  const codeInstall = await highlightCode('bun add varlock', 'bash');
  const codeUsage = await highlightCode(
    `import { load } from 'varlock';
import { ENV } from 'varlock/env';

await load(); // parse + validate .env.schema once at boot
const port = ENV.DEMO_API_PORT; // typed + coerced: a number, not a string`,
    'typescript',
  );
</script>

<DemoPage
  title="Varlock env schemas"
  description="Load a validated, typed .env schema with Varlock and read live config through the ENV proxy on every SSR render — with types, coercion, variable expansion, and redacted secrets."
  {sources}
>
  <div class="intro">
    <p>
      <a href="https://varlock.dev" target="_blank" rel="noopener noreferrer">Varlock</a> turns your
      <code>.env</code> into a validated, typed schema — a <code>.env.schema</code> annotated with JSDoc-style decorators (<code>@type</code>, <code>@required</code>,
      <code>@sensitive</code>). Mochi renders every page on the server on each request, so there's nothing to prerender or statically inline: you <code>load()</code> the schema
      once at boot, then read live values through the typed <code>ENV</code> proxy during SSR.
    </p>
    <CodeSnippet html={codeInstall} />
    <p>Point <code>package.json</code>'s <code>varlock.loadPath</code> at your schema, then:</p>
    <CodeSnippet html={codeUsage} />
    <p>See the full decorator DSL at <a href="https://varlock.dev" target="_blank" rel="noopener noreferrer">varlock.dev</a>.</p>
  </div>

  <section class="card">
    <header>
      <h2>Resolved on this request</h2>
      <p>These values were parsed, coerced, and validated by <code>varlock</code> during this page's SSR render.</p>
    </header>
    <table class="config">
      <thead>
        <tr><th>Variable</th><th>Value</th><th>Reads as</th></tr>
      </thead>
      <tbody>
        {#each config.items as item (item.key)}
          <tr>
            <td class="var">
              <code>{item.key}</code>
              {#if item.isSensitive}<Badge kind="danger">@sensitive</Badge>{/if}
            </td>
            <td>
              {#if item.isSensitive}
                <span class="masked">••••••••</span>
              {:else}
                <code>{item.value}</code>
              {/if}
            </td>
            <td><code>{item.jsType}</code></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="note">
      <code>DEMO_API_PORT</code> arrives as a JavaScript <code>number</code> ({config.apiPort}), and
      <code>DEMO_API_URL</code> already has its <code>{'${DEMO_API_PORT}'}</code> reference expanded to
      <code>{config.apiUrl}</code>. The <code>@sensitive</code> key never leaves the server — it's masked before it reaches the props, and <code>patchGlobalConsole()</code> keeps it
      out of your logs.
    </p>
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

  .config {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  .config th {
    text-align: left;
    font-weight: 600;
    color: var(--text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .config td {
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }

  .config td.var {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .config code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    color: var(--text);
  }

  .masked {
    font-family: var(--font-mono);
    letter-spacing: 0.15em;
    color: var(--text-muted);
  }

  .note {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin: 1rem 0 0;
    line-height: 1.6;
  }

  .note code {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
  }
</style>
