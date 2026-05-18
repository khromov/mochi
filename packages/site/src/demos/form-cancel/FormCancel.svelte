<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import CancelDemo from './CancelDemo.svelte';
  import AbortDemo from './AbortDemo.svelte';
  import PlainDemo from './PlainDemo.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'FormCancel.svelte', path: './src/demos/form-cancel/FormCancel.svelte' },
    { label: 'CancelDemo.svelte', path: './src/demos/form-cancel/CancelDemo.svelte' },
    { label: 'AbortDemo.svelte', path: './src/demos/form-cancel/AbortDemo.svelte' },
    { label: 'PlainDemo.svelte', path: './src/demos/form-cancel/PlainDemo.svelte' },
    { label: 'routes.ts', path: './src/demos/form-cancel/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Cancelling form submissions"
  description={`Inside {@attach enhance(...)} there are two distinct cancellation points: cancel() short-circuits before the fetch is issued; controller.abort() stops a request that is already in flight. They solve different problems — they are not interchangeable.`}
  {sources}
>
  <p>The action sleeps 3 s to simulate a slow lookup. Each variant below uses the same action but cancels at a different point — or not at all.</p>

  <h3><code>cancel()</code> — pre-flight short-circuit</h3>
  <p>
    The <code>submit</code> callback receives <code>cancel</code>. Calling it skips the fetch entirely — no request is sent, no result callback runs. Use this for client-side
    validation or any condition you can check before leaving the browser.
  </p>
  <CancelDemo label="Type fewer than 3 characters and submit — cancel() fires, no network request" mochi:hydrate />

  <h3><code>controller.abort()</code> — in-flight cancellation</h3>
  <p>
    The <code>submit</code> callback also receives an
    <code>AbortController</code>. Calling <code>controller.abort()</code>
    stops a fetch that has already started. Here a 1.5 s timeout aborts the 3 s lookup; <code>enhance</code> swallows the <code>AbortError</code> and resets the form to idle.
  </p>
  <AbortDemo label="Submit any query — the request aborts after 1.5 s" mochi:hydrate />

  <h3>Plain HTML — no <code>enhance</code></h3>
  <p>Without JavaScript there is nothing to cancel. The browser POSTs and waits the full 3 s, then the page re-renders with the result.</p>
  <PlainDemo label="Plain POST — waits the full 3 s, page re-renders with the result" />
</DemoPage>

<style>
  h3 {
    margin: 1.5rem 0 0.25rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  p {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
</style>
