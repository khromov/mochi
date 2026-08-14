<script lang="ts">
  import './app.generated.css';
  import { url } from 'mochi-framework';
  import { MetaTags } from 'svelte-meta-tags';
  import TodoApp from './TodoApp.svelte';
  import { mergeMetaTags } from '../lib/baseMetaTags';

  const metaTags = mergeMetaTags({
    title: 'Today — a Mochi + Tailwind demo',
    description: 'A small Tailwind v4 todo app on Mochi. Server-rendered, hydrated, persists to localStorage.',
    canonical: `https://demos.mochi.fast${url.pathname}`,
  });
</script>

<MetaTags {...metaTags} />

<div class="todo-app">
  <TodoApp mochi:hydrate />
</div>

<style>
  /* Scoped reset — shell.html ships no universal reset and Tailwind preflight is off, so this subtree owns its own normalization, confined to .todo-app so it never leaks into HN/Admin. */
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
