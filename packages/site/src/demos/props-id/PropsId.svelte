<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import Field from './Field.svelte';
  import LabeledField from './LabeledField.svelte';
  import ServerStamp from './ServerStamp.svelte';
  import ServerHydratedStamp from './ServerHydratedStamp.svelte';
  import ClientStamp from './ClientStamp.svelte';

  const sources = await compiled(() => loadSources(files));
</script>

<DemoPage
  title="Unique IDs"
  description="Svelte's native $props.id() generates an id unique to each component instance, consistent between server render and hydration — use it for label/for and aria links inside islands."
  {sources}
>
  <h3>Static component (no hydration)</h3>
  <p class="hint">$props.id() works with zero JavaScript shipped — the id is minted during SSR, no hydration required.</p>
  <Field />

  <h3>Two hydrated islands, two ids</h3>
  <p class="hint">Each instance gets its own id, so the label/for pairs never collide. Hydration reuses the server-generated value — the id you see was minted during SSR.</p>
  <LabeledField mochi:hydrate />
  <LabeledField mochi:hydrate />

  <h3>Server island</h3>
  <p class="hint">
    Deferred islands render in a separate request; Mochi namespaces their ids with the island's own id (via render's idPrefix) so they cannot collide with ids already on the page.
  </p>
  <ServerStamp mochi:defer />

  <h3>Server island that also hydrates</h3>
  <p class="hint">
    With <code>mochi:defer mochi:hydrate</code> the namespaced id is read back from the SSR markers when the fragment hydrates — click the button and the id stays exactly the same, proving
    the value survived from the deferred render into the hydrated client.
  </p>
  <ServerHydratedStamp mochi:defer mochi:hydrate />

  <h3>Two client-only islands, two ids</h3>
  <p class="hint">
    Client-only islands are never server-rendered, so each <code>$props.id()</code> is minted in the browser at mount. Svelte draws these from a global counter — unique even across
    separate
    <code>mount()</code> calls — so two independently-mounted islands still get distinct ids (e.g. <code>c1</code> and <code>c2</code>) without any SSR pass to keep them apart.
  </p>
  <ClientStamp mochi:clientOnly />
  <ClientStamp mochi:clientOnly />
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
