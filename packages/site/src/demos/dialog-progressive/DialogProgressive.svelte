<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import ProgressiveDialog from './ProgressiveDialog.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Progressive Dialog"
  description="One <dialog> component that works with and without JavaScript. The open control is a real link the server honours by rendering <dialog open>; when JavaScript is present it intercepts the click and calls showModal() instead."
  {sources}
>
  <p>
    The trick is that nothing about opening the dialog depends on JavaScript existing. The control is an <code>&lt;a href="?terms"&gt;</code>, and the component reads
    <code>url.searchParams</code> isomorphically — so the server renders <code>&lt;dialog open&gt;</code> for that URL all on its own. JavaScript, when it arrives, only adds an
    <code>onclick</code> that calls <code>preventDefault()</code> and <code>showModal()</code>, upgrading a navigation into a real modal.
  </p>
  <p>
    Below is the same component twice. The first is hydrated, so clicking opens a modal with no navigation. The second is not hydrated at all — clicking performs a real navigation
    and the dialog comes back already open, which is exactly what the first one degrades to when JavaScript is disabled or fails to load.
  </p>

  <div class="stack">
    <ProgressiveDialog mochi:hydrate name="terms" label="mochi:hydrate — intercepted, opens as a modal" />
    <ProgressiveDialog name="terms-plain" label="No directive — full navigation, server renders it open" />
  </div>

  <p class="footnote">
    See also the <a href="/demos/dialog-hydrated/">hydrated dialog</a> for <code>returnValue</code>, and the <a href="/demos/dialog-popover/">popover dialog</a> for an open/close
    dialog that needs no JavaScript at all.
  </p>
</DemoPage>

<style>
  p {
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.55;
    margin-bottom: 1rem;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    margin: 1.5rem 0;
  }

  .footnote {
    font-size: 0.9rem;
    margin-bottom: 0;
  }

  code {
    font-family: var(--font-mono);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
    font-weight: 500;
  }

  a {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
