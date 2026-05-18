<script lang="ts">
  import { enhance } from 'mochi-framework';
  import type { MochiEnhanceOptions, MochiSubmitFunction } from 'mochi-framework';

  let { label } = $props<{ label: string }>();

  let pending = $state(false);
  let result = $state<string | null>(null);
  let message = $state<string | null>(null);
  let gotResult = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const handleSubmit: MochiSubmitFunction<{ result: string }, { error: string }> = ({ controller }) => {
    result = null;
    message = null;
    gotResult = false;
    timeoutId = setTimeout(() => controller.abort(), 1500);
    return ({ result: r }) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = null;
      gotResult = true;
      if (r.type === 'success' && r.data) {
        result = r.data.result;
      } else if (r.type === 'failure' && r.data) {
        message = r.data.error;
      }
    };
  };

  const opts: MochiEnhanceOptions<{ result: string }, { error: string }> = {
    submit: handleSubmit,
    onPending: (v) => {
      pending = v;
      if (!v && !gotResult) {
        message = 'Request timed out after 1.5 s — aborted in flight.';
      }
    },
  };
</script>

<div class="demo-block">
  <p class="label">{label}</p>
  <form method="POST" action="?/lookup" class="lookup" {@attach enhance(opts)}>
    <label>
      <span>Query</span>
      <input name="query" placeholder="Enter a name…" required disabled={pending} />
    </label>
    <button type="submit" disabled={pending}>{pending ? 'Searching…' : 'Search'}</button>
  </form>
  {#if result}
    <p class="result" role="status">{result}</p>
  {/if}
  {#if message}
    <p class="message" role="alert">{message}</p>
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

  .lookup input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  button:hover:not(:disabled) {
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
