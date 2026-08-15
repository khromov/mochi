<script lang="ts">
  import Greeting from './components/Greeting.svelte';
  import { listTodos } from './lib/todos';

  const todos = listTodos();
</script>

<main>
  <h1>Mochi × Capacitor</h1>
  <Greeting mochi:hydrate name="Mochi" />
  <ul>
    {#each todos as todo (todo.id)}
      <li><a href={`#/todos/${todo.id}`}>{todo.title}</a></li>
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
