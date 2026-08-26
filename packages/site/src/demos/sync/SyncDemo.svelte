<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import TodoList from './TodoList.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Realtime sync"
  description="Two islands, each on its own connection, share one live todo list over a WebSocket. Add or toggle a todo in one and it appears in the other. Take an island offline to watch it diverge — its writes queue locally — then bring it back online to reconnect and converge."
  {sources}
>
  <div class="sync-grid">
    <TodoList label="Island A" connection="island-a" mochi:hydrate />
    <TodoList label="Island B" connection="island-b" mochi:hydrate />
  </div>
</DemoPage>

<style>
  .sync-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  @media (max-width: 640px) {
    .sync-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
