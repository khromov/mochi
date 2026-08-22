<script lang="ts">
  import { enhance } from 'mochi-framework';
  import type { MochiEnhanceOptions, MochiSubmitFunction } from 'mochi-framework';

  type GuestbookEntry = { id: string; name: string; at: number };

  let { entries: initialEntries }: { entries: GuestbookEntry[] } = $props();

  // svelte-ignore state_referenced_locally
  let entries = $state<GuestbookEntry[]>(initialEntries);
  let errorMessage = $state<string | null>(null);
  let pending = $state(false);

  async function refetch(): Promise<void> {
    const res = await fetch('/api/guestbook', { headers: { accept: 'application/json' }, cache: 'no-store' });
    const body = (await res.json()) as { entries: GuestbookEntry[] };
    entries = body.entries;
  }

  const handleSign: MochiSubmitFunction<Record<string, never>, { error: string }> = () => {
    errorMessage = null;
    return async ({ result, formElement }) => {
      if (result.type === 'success') {
        formElement.reset();
        await refetch();
      } else if (result.type === 'failure' && result.data) {
        errorMessage = result.data.error;
      } else if (result.type === 'error') {
        errorMessage = 'Network error. Try again.';
      }
    };
  };

  const opts: MochiEnhanceOptions<Record<string, never>, { error: string }> = {
    submit: handleSign,
    onPending: (v) => {
      pending = v;
    },
  };

  function formatTime(at: number): string {
    return new Date(at).toLocaleTimeString();
  }
</script>

<div class="guestbook">
  {#if entries.length === 0}
    <p class="empty">No entries yet. Be the first to sign.</p>
  {:else}
    <ul class="entries">
      {#each entries as entry (entry.id)}
        <li>
          <span class="name">{entry.name}</span>
          <span class="time">{formatTime(entry.at)}</span>
        </li>
      {/each}
    </ul>
  {/if}

  <form method="POST" action="?/guestbookSign" class="sign" {@attach enhance(opts)}>
    <label>
      <span>Your name</span>
      <input name="name" maxlength="50" disabled={pending} required />
    </label>
    <div class="submit-row">
      <button type="submit" disabled={pending}>{pending ? 'Signing…' : 'Sign guestbook'}</button>
      {#if errorMessage}
        <p class="error" role="alert">{errorMessage}</p>
      {/if}
    </div>
  </form>
</div>

<style>
  .guestbook {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    margin-top: 0.75rem;
  }

  .empty {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-subtle);
    font-style: italic;
  }

  .entries {
    list-style: none;
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 12rem;
    overflow-y: auto;
  }

  .entries li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.9rem;
  }

  .name {
    color: var(--text);
    font-weight: 600;
  }

  .time {
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .sign {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .sign label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .sign input {
    padding: 0.5rem 0.7rem;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 0.95rem;
  }

  .sign input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--surface-muted);
  }

  .sign input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .sign button {
    align-self: flex-start;
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

  .sign button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .sign button:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .submit-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .error {
    margin: 0;
    font-size: 0.9rem;
    color: var(--badge-danger-text);
  }
</style>
