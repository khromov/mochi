<script lang="ts">
  let dialog: HTMLDialogElement;
  let result = $state('');
</script>

<button type="button" onclick={() => dialog.showModal()}>Open modal</button>

<dialog bind:this={dialog} onclose={() => (result = dialog.returnValue)}>
  <h3>Delete this file?</h3>
  <p>Nothing is actually deleted — this dialog only reports which button you pressed.</p>
  <form method="dialog">
    <button value="cancel">Cancel</button>
    <button value="ok" class="primary">Delete</button>
  </form>
</dialog>

<p class="result">Returned: <code>{result || '—'}</code></p>

<style>
  dialog {
    /* The shell's `* { margin: 0 }` reset kills the UA's `margin: auto`, which is
       what centers a modal dialog — without this it renders in the top-left. */
    margin: auto;
    max-width: 26rem;
    width: calc(100vw - 2rem);
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  dialog::backdrop {
    background: rgba(31, 42, 36, 0.45);
  }

  h3 {
    font-family: var(--font-serif);
    font-size: 1.25rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  dialog p {
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
    margin-bottom: 1.25rem;
  }

  form {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  button {
    font: inherit;
    font-size: 1rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  button:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  button:focus-visible {
    box-shadow: var(--focus-ring);
    outline: none;
  }

  form button {
    font-size: 0.9rem;
  }

  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: var(--accent-text);
  }

  .result {
    margin-top: 0.85rem;
    font-size: 0.95rem;
    color: var(--text-muted);
  }

  code {
    font-family: var(--font-mono);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.9em;
  }
</style>
