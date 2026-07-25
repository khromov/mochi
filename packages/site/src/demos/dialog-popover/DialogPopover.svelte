<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import PopoverDialog from './PopoverDialog.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Popover Dialog"
  description="The native <dialog> element with no hydration at all. The popover attribute plus popovertarget buttons open and close it in the browser's top layer — no client JavaScript, no server round-trip, no navigation."
  {sources}
>
  <p>
    There is no <code>mochi:hydrate</code> here and no <code>&lt;script&gt;</code> in the component — just <code>popover</code> on the <code>&lt;dialog&gt;</code> and
    <code>popovertarget</code> on the buttons. The browser gives you the top layer (so <code>overflow: hidden</code> on an ancestor can't clip it), a <code>::backdrop</code>,
    light-dismiss on an outside click, and Escape to close.
  </p>
  <p>
    The tradeoff versus <a href="/demos/dialog-hydrated/">showModal()</a>: a popover is <em>not</em> modal. It does not make the rest of the page <code>inert</code>, and it does
    not give you <code>returnValue</code>. Reach for it when a dialog only needs to open and close.
  </p>

  <PopoverDialog />
</DemoPage>

<style>
  p {
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.55;
    margin-bottom: 1rem;
  }

  p:last-of-type {
    margin-bottom: 1.25rem;
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
