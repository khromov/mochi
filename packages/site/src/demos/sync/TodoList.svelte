<script lang="ts">
  import { sync } from 'mochi-framework';
  import type { Todo } from './schema';

  let { label = 'Client' } = $props();

  const todos = sync<Todo>('todos');

  let text = $state('');

  function add() {
    const value = text.trim();
    if (!value) {
      return;
    }
    todos.insert({ text: value, done: false });
    text = '';
  }
</script>

<div class="todo-island">
  <div class="head">
    <strong>{label}</strong>
    <span class="status" data-status={todos.status}>{todos.status}{todos.pending > 0 ? ` · ${todos.pending} pending` : ''}</span>
  </div>

  <form
    onsubmit={(e) => {
      e.preventDefault();
      add();
    }}
  >
    <input type="text" bind:value={text} placeholder="Add a todo…" aria-label="Todo text" />
    <button type="submit">Add</button>
  </form>

  <ul>
    {#each todos.rows as todo (todo.id)}
      <li>
        <label>
          <input type="checkbox" checked={todo.done} onchange={() => todos.update(todo.id, { done: !todo.done })} />
          <span class:done={todo.done}>{todo.text}</span>
        </label>
        <button class="remove" onclick={() => todos.remove(todo.id)} aria-label="Delete todo">×</button>
      </li>
    {:else}
      <li class="empty">No todos yet.</li>
    {/each}
  </ul>
</div>

<style>
  .todo-island {
    border: 1px solid var(--border, #d0d0d0);
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .status {
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }
  .status[data-status='synced'],
  .status[data-status='connected'] {
    color: #16a34a;
    opacity: 1;
  }
  .status[data-status='error'],
  .status[data-status='disconnected'] {
    color: #dc2626;
    opacity: 1;
  }
  form {
    display: flex;
    gap: 0.5rem;
  }
  input[type='text'] {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border, #d0d0d0);
    border-radius: 6px;
  }
  button {
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    border: 1px solid var(--border, #d0d0d0);
    cursor: pointer;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  li label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }
  .done {
    text-decoration: line-through;
    opacity: 0.6;
  }
  .empty {
    opacity: 0.5;
    font-style: italic;
  }
  .remove {
    padding: 0.1rem 0.5rem;
    line-height: 1;
  }
</style>
