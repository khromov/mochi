<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import FormIsland from './FormIsland.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'Page.svelte', path: './src/demos/props-id/Page.svelte' },
    { label: 'FormIsland.svelte', path: './src/demos/props-id/FormIsland.svelte' },
    { label: 'routes.ts', path: './src/demos/props-id/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Svelte 5 $props.id()"
  description="Use Svelte 5's native $props.id() to generate stable, unique IDs across server and client renders. Perfect for linking forms and labels within islands."
  {sources}
>
  <div class="demo-content">
    <p>
      Two instances of the same hydratable island below. Each generates a unique <code>$props.id()</code> to link its label to its input field. The ID matches between server and
      client without needing the framework to pass an <code>islandId</code> prop.
    </p>

    <div class="islands">
      <FormIsland mochi:hydrate label="First Name" />
      <FormIsland mochi:hydrate label="Last Name" />
    </div>
  </div>
</DemoPage>

<style>
  .demo-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .demo-content p {
    margin: 0;
    color: var(--text);
    line-height: 1.5;
  }
  .islands {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
</style>
