<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import RedirectDemo from './RedirectDemo.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);

  let { redirected }: { redirected: boolean } = $props();
</script>

<DemoPage
  title="Form Redirects"
  description={`You can return redirect(<code>, …) from an action. With {@attach enhance(...)}, the JSON envelope is intercepted before navigating. Without it, the browser follows the native 303 response.`}
  {sources}
>
  {#if redirected}
    <p class="redirect-flash" role="status">Redirected here via HTTP 303 (non-enhanced path).</p>
  {/if}

  <p>
    The action returns <code>redirect(303, …)</code>. With <code>{'{@attach enhance(...)}'}</code> the JSON envelope is intercepted so you can inspect it before navigating. Without it,
    the browser follows the HTTP 303.
  </p>
  <h3>With <code>{'{@attach enhance(...)}'}</code></h3>
  <RedirectDemo label="The enhance attachment intercepts the redirect envelope; click Follow to navigate" mochi:hydrate />
  <h3>Plain HTML</h3>
  <RedirectDemo label="Plain POST, server returns 303, browser follows the Location header" />
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

  .redirect-flash {
    padding: 0.5rem 0.75rem;
    background: var(--badge-info-bg, #dbeafe);
    color: var(--badge-info-text, #1e40af);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    margin: 0 0 1rem;
  }
</style>
