<script lang="ts">
  import OfflineNotice from './components/OfflineNotice.svelte';
  import type { Todo } from './lib/todos';
  import { appHref } from './lib/links';

  let { todo, offline = false }: { todo: Todo | null; offline?: boolean } = $props();
</script>

<main>
  {#if offline}
    <OfflineNotice />
  {/if}
  {#if todo}
    <h1>{todo.title}</h1>
    <p>Due {todo.due.toLocaleDateString()} — the Date survived the wire thanks to devalue.</p>
    <p>{todo.done ? 'Done' : 'Open'}</p>
  {:else}
    <p>Todo not found.</p>
  {/if}
  <a href={appHref('/')}>← Back</a>
</main>

<style>
  main {
    max-width: 32rem;
    margin: 2rem auto;
    padding: 0 1rem;
    font-family: system-ui, sans-serif;
  }
</style>
