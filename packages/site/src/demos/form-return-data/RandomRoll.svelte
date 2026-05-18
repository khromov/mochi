<script lang="ts">
  import { enhance, isServer, getRequestContext } from 'mochi-framework';
  import type { MochiSubmitFunction } from 'mochi-framework';

  let { label, isHydratable } = $props<{ label: string; isHydratable?: boolean }>();

  // svelte-ignore state_referenced_locally
  const _form = !isHydratable && isServer ? getRequestContext().form : null;
  const initialValue = _form?.ok && _form.action === 'random' && typeof _form.data.value === 'number' ? _form.data.value : null;

  let currentValue = $state<number | null>(initialValue);
  let pending = $state(false);

  const handleRoll: MochiSubmitFunction<{ value: number }> = () => {
    pending = true;
    return ({ result }) => {
      pending = false;
      if (result.type === 'success' && result.data) {
        currentValue = result.data.value;
      }
    };
  };
</script>

<form method="POST" action="?/random" class="roll" {@attach enhance(handleRoll)}>
  <p class="label">{label}</p>
  <label>
    <span>Random number</span>
    <input type="text" readonly value={currentValue ?? ''} placeholder="(click roll)" />
  </label>
  <button type="submit" disabled={pending}>{pending ? 'Rolling…' : 'Roll'}</button>
</form>

<style>
  .roll {
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

  .roll label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .roll input {
    padding: 0.5rem 0.7rem;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 1rem;
    width: 8rem;
    text-align: center;
  }

  .roll button {
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

  .roll button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .roll button:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
</style>
