<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import LabeledField from './LabeledField.svelte';
  import ServerStamp from './ServerStamp.svelte';

  const sources = await loadSources([
    { label: 'PropsId.svelte', path: './src/demos/props-id/PropsId.svelte' },
    { label: 'LabeledField.svelte', path: './src/demos/props-id/LabeledField.svelte' },
    { label: 'ServerStamp.svelte', path: './src/demos/props-id/ServerStamp.svelte' },
    { label: 'routes.ts', path: './src/demos/props-id/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Unique IDs"
  description="Svelte's native $props.id() generates an id unique to each component instance, consistent between server render and hydration — use it for label/for and aria links inside islands."
  {sources}
>
  <h3>Two hydrated islands, two ids</h3>
  <p class="hint">Each instance gets its own id, so the label/for pairs never collide. Hydration reuses the server-generated value — the id you see was minted during SSR.</p>
  <LabeledField mochi:hydrate />
  <LabeledField mochi:hydrate />

  <h3>Server island</h3>
  <p class="hint">
    Deferred islands render in a separate request; Mochi namespaces their ids with the island's own id (via render's idPrefix) so they cannot collide with ids already on the page.
  </p>
  <ServerStamp mochi:defer />
</DemoPage>

<style>
  h3 {
    margin: 1.5rem 0 0.25rem;
    font-size: 1rem;
    font-weight: 600;
  }
  .hint {
    color: var(--text-muted);
    font-size: 0.85em;
    margin: 0 0 0.5rem;
  }
</style>
