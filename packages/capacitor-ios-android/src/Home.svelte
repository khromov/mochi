<script lang="ts">
  import Greeting from './components/Greeting.svelte';
  import OfflineNotice from './components/OfflineNotice.svelte';
  import { listTodos, type Todo } from './lib/todos';
  import { appHref } from './lib/links';

  // Defaults keep the Mochi.serve() page prop-free; the standalone route passes both via clientProps.
  let { todos = listTodos(), offline = false }: { todos?: Todo[]; offline?: boolean } = $props();
</script>

<main>
  <h1>Mochi × Capacitor</h1>
  {#if offline}
    <OfflineNotice />
  {/if}
  <Greeting mochi:hydrate name="Mochi" />
  <ul>
    {#each todos as todo (todo.id)}
      <li><a href={appHref(`/todos/${todo.id}`)}>{todo.title}</a></li>
    {/each}
  </ul>
</main>

<style>
  main {
    max-width: 32rem;
    margin: 2rem auto;
    padding: 0 1rem;
    font-family: system-ui, sans-serif;
  }
  ul {
    padding-left: 1.25rem;
  }
  li {
    margin: 0.5rem 0;
  }
</style>
