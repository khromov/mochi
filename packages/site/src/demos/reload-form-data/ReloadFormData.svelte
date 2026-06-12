<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import Guestbook from './Guestbook.svelte';
  import { loadSources } from '../../components/utils.ts';

  type GuestbookEntry = { id: string; name: string; at: number };

  const sources = await loadSources([
    { label: 'ReloadFormData.svelte', path: './src/demos/reload-form-data/ReloadFormData.svelte' },
    { label: 'Guestbook.svelte', path: './src/demos/reload-form-data/Guestbook.svelte' },
    { label: 'routes.ts', path: './src/demos/reload-form-data/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);

  let { guestbook }: { guestbook: GuestbookEntry[] } = $props();
</script>

<DemoPage
  title="Reloading associated form data"
  description="This page shows a pattern to reload associated data on a form submit. The plain HTML version simply reloads the page (the normal form behavior) which reloads the data. For associated data you can reload this inside the enhance callback."
  {sources}
>
  <p>
    Each successful submit appends the name to an in-memory list on the server. The hydrated version refetches <code>/api/guestbook</code> after a successful submit and updates the
    list in place. The plain version submits natively, the page re-renders with a fresh <code>guestbook</code> serverProp, and the new name shows up after the reload.
  </p>
  <h3>With <code>{'{@attach enhance(...)}'}</code></h3>
  <Guestbook entries={guestbook} mochi:hydrate />
  <h3>Plain HTML</h3>
  <Guestbook entries={guestbook} />
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
