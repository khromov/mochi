<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CounterButton from './CounterButton.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'SharedState.svelte', path: './src/demos/shared-state/SharedState.svelte' },
    { label: 'CounterButton.svelte', path: './src/demos/shared-state/CounterButton.svelte' },
    { label: 'likes.svelte.ts', path: './src/stores/likes.svelte.ts' },
    { label: 'routes.ts', path: './src/demos/shared-state/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Shared State"
  description="You can share reactive $state between separately-hydrated islands. Click either button — the count stays in sync across both."
  {sources}
>
  <div class="row">
    <CounterButton mochi:hydrate />
    <CounterButton mochi:hydrate />
  </div>
</DemoPage>

<style>
  .row {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
</style>
