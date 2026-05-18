<script lang="ts">
  import { isServer, getRequestContext } from 'mochi-framework';

  let { label } = $props<{ label: string }>();

  const _form = isServer ? getRequestContext().form : null;
  const initialResult: string | null = _form?.ok && _form.action === 'lookup' ? String(_form.data.result ?? '') : null;
  const initialMessage: string | null = !_form?.ok && _form?.action === 'lookup' ? String(_form.data.error ?? '') : null;
</script>

<div class="demo-block">
  <p class="label">{label}</p>
  <form method="POST" action="?/lookup" class="lookup">
    <label>
      <span>Query</span>
      <input name="query" placeholder="Enter a name…" required />
    </label>
    <button type="submit">Search</button>
  </form>
  {#if initialResult}
    <p class="result" role="status">{initialResult}</p>
  {/if}
  {#if initialMessage}
    <p class="message" role="alert">{initialMessage}</p>
  {/if}
</div>

<style>
  .demo-block {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: flex-start;
    margin-top: 0.75rem;
  }

  .label {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  .lookup {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: flex-start;
  }

  .lookup label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .lookup input {
    padding: 0.5rem 0.7rem;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 0.95rem;
    min-width: 16rem;
  }

  .lookup input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  button {
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: var(--accent-text);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }

  button:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .result {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.9rem;
    color: var(--text);
  }

  .message {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-subtle);
    font-style: italic;
  }
</style>
