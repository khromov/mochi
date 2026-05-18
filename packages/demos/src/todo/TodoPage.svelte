<script lang="ts">
  import './app.generated.css';
  import TodoApp from './TodoApp.svelte';
</script>

<svelte:head>
  <title>Today — a Mochi + Tailwind demo</title>
  <meta name="description" content="A small Tailwind v4 todo app on Mochi. Server-rendered, hydrated, persists to localStorage." />
</svelte:head>

<div class="todo-app">
  <TodoApp mochi:hydrate />
</div>

<style>
  /* Scoped reset — the demos shell.html no longer ships a universal reset,
     and Tailwind preflight is intentionally off, so the todo subtree owns
     normalization for the elements it actually uses. Confined to .todo-app
     descendants so it never leaks into HN/Admin. */
  .todo-app :global(*),
  .todo-app :global(*::before),
  .todo-app :global(*::after) {
    box-sizing: border-box;
  }

  .todo-app :global(button),
  .todo-app :global(input) {
    font: inherit;
    color: inherit;
  }

  .todo-app :global(button) {
    appearance: none;
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
  }

  .todo-app :global(input) {
    background: transparent;
    border: 0;
    outline: 0;
    padding: 0;
  }

  .todo-app :global(ul) {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .todo-app :global(p),
  .todo-app :global(h1),
  .todo-app :global(h2),
  .todo-app :global(h3) {
    margin: 0;
  }

  :global(body) {
    margin: 0;
    min-height: 100vh;
    font-family:
      'Public Sans',
      ui-sans-serif,
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
    color: #1c1917; /* stone-900 */
    background: #faf9f7;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
</style>
