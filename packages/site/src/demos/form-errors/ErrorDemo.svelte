<script lang="ts">
  import { enhance } from 'mochi-framework';
  import type { MochiSubmitFunction } from 'mochi-framework';

  let { label }: { label: string } = $props();

  let errorMessage = $state<string | null>(null);
  let pending = $state(false);

  const handleSubmit: MochiSubmitFunction = () => {
    pending = true;
    errorMessage = null;
    return ({ result }) => {
      pending = false;
      if (result.type === 'error') {
        errorMessage = (result.error as { message?: string })?.message ?? 'Unknown server error';
      }
    };
  };
</script>

<div class="demo-block">
  <p class="label">{label}</p>
  <form method="POST" action="?/throwError" {@attach enhance(handleSubmit)}>
    {#if errorMessage}
      <p class="error" role="alert">{errorMessage}</p>
    {/if}
    <button type="submit" disabled={pending}>{pending ? 'Throwing…' : 'Trigger server error'}</button>
  </form>
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

  .error {
    margin: 0 0 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--badge-danger-bg);
    color: var(--badge-danger-text);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
  }

  button {
    padding: 0.5rem 1rem;
    background: var(--badge-danger-bg);
    color: var(--badge-danger-text);
    border: 1px solid var(--badge-danger-text);
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
    opacity: 0.85;
  }
</style>
