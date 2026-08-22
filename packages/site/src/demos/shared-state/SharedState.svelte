<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CounterButton from './CounterButton.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await compiled(() => loadSources(files));
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
