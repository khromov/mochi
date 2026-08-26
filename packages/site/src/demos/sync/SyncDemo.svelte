<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import TodoList from './TodoList.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Realtime sync"
  description="Two independent islands share one live todo list over a WebSocket. Add or toggle a todo in one and it appears in the other — the server is authoritative, writes are optimistic, and every tab stays in sync."
  {sources}
>
  <div class="sync-grid">
    <TodoList label="Island A" mochi:hydrate />
    <TodoList label="Island B" mochi:hydrate />
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
