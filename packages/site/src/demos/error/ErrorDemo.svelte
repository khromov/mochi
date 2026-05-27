<script>
  import { highlightCode } from '../../lib/highlight.server';
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'ErrorDemo.svelte', path: './src/demos/error/ErrorDemo.svelte' },
    { label: 'Error500.svelte', path: './src/demos/error/Error500.svelte' },
    { label: 'routes.ts', path: './src/demos/error/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);

  const handleErrorSnippet = `const handleError: HandleError = ({ error, event, status, message }) => {
  logger.info(
    \`handleError: \${event.url.pathname} → \${status} "\${message}" (error \${error ? 'present' : 'null'})\`,
  );
  // error is null for unmatched routes / unknown form actions — guard before forwarding
  if (error && status >= 500) {
    logger.error('app:', event.url.pathname, error);
  }
  // Short-circuit: redirect this specific demo path instead of rendering the error page
  if (event.url.pathname === '/demos/error/redirect') {
    return Response.redirect(new URL('/demos/error', event.url), 302);
  }
};`;
  const handleErrorHtml = await highlightCode(handleErrorSnippet, 'ts');
</script>

<DemoPage title="Error Handling" description="You can route render errors and unmatched routes through Mochi.serve()'s errorPage option and the handleError hook." {sources}>
  <div class="prose">
    <p>
      Mochi catches any throw from a page's <code>serverProps</code> resolver or Svelte <code>&lt;script&gt;</code>, plus any request that doesn't match a route, and renders the
      built-in default error page. Pass your own <code>errorPage</code> to <code>Mochi.serve()</code> to replace it. The <code>handleError</code> hook runs for every error — use it
      to log, forward to an error tracker, sanitize the message, or return a <code>Response</code> to short-circuit rendering.
    </p>

    <p class="lead">Try it:</p>

    <ul class="examples">
      <li>
        <a href="/demos/error/500/"><code>/demos/error/500</code></a>
        <span>the page's <code>&lt;script&gt;</code> throws during SSR</span>
      </li>
      <li>
        <a href="/demos/error/404/"><code>/demos/error/404</code></a>
        <span>the <code>serverProps</code> resolver calls <code>error(404, ...)</code></span>
      </li>
      <li>
        <a href="/does-not-exist/"><code>/does-not-exist</code></a>
        <span>no route matches — <code>handleError</code> fires with <code>error: null</code>, then the error page renders with status 404</span>
      </li>
      <li>
        <a href="/demos/error/redirect/"><code>/demos/error/redirect</code></a>
        <span>
          the page throws, but <code>handleError</code> returns <code>Response.redirect(...)</code> — you land back on this page instead of seeing the error component
        </span>
      </li>
    </ul>

    <p>
      A custom error component receives a single <code>error</code> prop with <code>status</code>,
      <code>message</code>, and (in development only) <code>stack</code> — typed as
      <code>MochiErrorProps</code>.
    </p>

    <p class="lead">This site's <code>handleError</code>:</p>

    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html handleErrorHtml}

    <p>
      Watch your dev server output while clicking the links above — each visit logs one
      <code>handleError:</code> line via <code>logger</code> from <code>mochi-framework</code>. Unmatched routes log <code>error null</code>; SSR throws log
      <code>error present</code>.
    </p>
  </div>
</DemoPage>

<style>
  .prose {
    font-size: 0.95rem;
    line-height: 1.6;
    color: var(--text);
  }

  .prose p {
    margin: 0 0 1rem;
  }

  .prose p.lead {
    margin-top: 0.5rem;
    margin-bottom: 0.5rem;
    font-weight: 600;
    color: var(--text);
  }

  .prose code {
    font-family: var(--font-mono);
    background: var(--surface-muted);
    padding: 0.12rem 0.4rem;
    border-radius: var(--radius-sm);
    font-size: 0.88em;
    color: var(--text);
  }

  .examples {
    list-style: none;
    margin: 0 0 1.25rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .examples li {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.6rem 0.85rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    flex-wrap: wrap;
  }

  .examples li a {
    text-decoration: none;
    flex-shrink: 0;
  }

  .examples li a code {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    transition:
      background 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }

  .examples li a:hover code {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  .examples li span {
    color: var(--text-muted);
    font-size: 0.88rem;
  }
</style>
