<script lang="ts">
  import { sync, syncConnection } from 'mochi-framework';
  import type { Todo } from './schema';

  let { label = 'Client', connection = 'default' } = $props();

  const todos = sync<Todo>('todos', undefined, { connection });
  const conn = syncConnection(connection);

  let text = $state('');
  let editingId = $state<string | null>(null);
  let editText = $state('');

  function add() {
    const value = text.trim();
    if (!value) {
      return;
    }
    todos.insert({ text: value, done: false });
    text = '';
  }

  function startEdit(id: string, current: string) {
    editingId = id;
    editText = current;
  }

  function commitEdit() {
    if (editingId === null) {
      return;
    }
    const value = editText.trim();
    if (value) {
      todos.update(editingId, { text: value });
    }
    editingId = null;
  }
</script>

<div class="todo-island" class:offline={!conn.online}>
  <div class="head">
    <strong>{label}</strong>
    <button type="button" class="toggle" data-online={conn.online} onclick={() => conn.setOnline(!conn.online)}>
      {conn.online ? 'Go offline' : 'Go online'}
    </button>
  </div>

  <div class="status-line">
    <span class="status" data-status={conn.status}>{conn.status}</span>
    {#if conn.pending > 0}
      <span class="pending">{conn.pending} queued</span>
    {/if}
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
        {#if editingId === todo.id}
          <input
            class="edit"
            type="text"
            bind:value={editText}
            aria-label="Edit todo text"
            onblur={commitEdit}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') {
                editingId = null;
              }
            }}
            {@attach (node) => {
              node.focus();
              node.select();
            }}
          />
        {:else}
          <label>
            <input type="checkbox" checked={todo.done} onchange={() => todos.update(todo.id, { done: !todo.done })} />
            <button type="button" class="text" class:done={todo.done} onclick={() => startEdit(todo.id, todo.text)} title="Click to edit">{todo.text}</button>
          </label>
          <button class="remove" onclick={() => todos.remove(todo.id)} aria-label="Delete todo">×</button>
        {/if}
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
    gap: 0.6rem;
    transition: opacity 0.15s;
  }
  .todo-island.offline {
    opacity: 0.85;
    border-style: dashed;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .toggle {
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    border: 1px solid var(--border, #d0d0d0);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .toggle[data-online='true'] {
    background: #16a34a;
    border-color: #16a34a;
    color: #fff;
  }
  .toggle[data-online='false'] {
    background: #dc2626;
    border-color: #dc2626;
    color: #fff;
  }
  .status-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    min-height: 1.5rem;
  }
  .status {
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
  .pending {
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    background: #f59e0b;
    color: #fff;
    font-variant-numeric: tabular-nums;
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
    flex: 1;
    cursor: pointer;
  }
  .text {
    flex: 1;
    text-align: left;
    padding: 0.1rem 0.25rem;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    cursor: text;
  }
  .text:hover {
    border-color: var(--border, #d0d0d0);
  }
  .done {
    text-decoration: line-through;
    opacity: 0.6;
  }
  input.edit {
    flex: 1;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border, #d0d0d0);
    border-radius: 6px;
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
