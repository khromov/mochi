<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import ProgressiveDialog from './ProgressiveDialog.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Progressive Dialog"
  description="One <dialog> that works either way. The popover attribute opens it with zero JavaScript and Accept POSTs to a form action; once the island hydrates, an attachment drops popover and takes over with showModal() plus enhance() so nothing navigates."
  {sources}
>
  <p>
    This combines the other two dialog demos into a single component. The server-rendered baseline is <code>&lt;dialog popover&gt;</code> plus <code>popovertarget</code> buttons — no
    JavaScript, no navigation. Because attachments never run during SSR, <code>{'{@attach upgrade}'}</code> is the precise moment JavaScript takes over: it removes the
    <code>popover</code> attribute and switches the trigger to <code>showModal()</code>.
  </p>
  <p>
    <strong>Accept</strong> is a real form action either way. Without JavaScript it POSTs to <code>?/accept</code> and the page re-renders, so the component reads the returned value
    out of <code>getRequestContext().form</code>; that read is wrapped in <code>hydratable()</code> so the value survives hydration instead of flipping back to empty. With
    JavaScript, <code>{'{@attach enhance(...)}'}</code> intercepts the same submit, so the result arrives as JSON and the modal just closes.
  </p>
  <p>
    One sharp edge worth copying: <strong>Cancel</strong> must be <code>type="button"</code>. A submit button's activation runs form submission <em>instead of</em> the popover
    action, so a plain <code>&lt;button&gt;</code> inside the form silently leaves no-JS visitors unable to close the dialog — which is exactly who the baseline exists to serve.
  </p>
  <p>
    Below is the same component twice. The first is hydrated, so it upgrades itself. The second has no directive, so it never hydrates — it stays on the popover baseline, which is
    exactly what the first degrades to when JavaScript is disabled or fails to load.
  </p>

  <div class="stack">
    <ProgressiveDialog mochi:hydrate name="modal" label="mochi:hydrate — upgraded to showModal(), Accept posts via enhance()" />
    <ProgressiveDialog name="plain" label="No directive — popover baseline, Accept does a full POST" />
  </div>

  <p class="footnote">
    See also the <a href="/demos/dialog-hydrated/">hydrated dialog</a> and the <a href="/demos/dialog-popover/">popover dialog</a> on their own.
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
