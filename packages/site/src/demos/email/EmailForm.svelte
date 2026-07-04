<script lang="ts">
  import { enhance, isServer, getRequestContext } from 'mochi-framework';
  import type { MochiEnhanceOptions, MochiSubmitFunction } from 'mochi-framework';
  import { EMAIL_PRESETS, DEMO_TO } from './presets.ts';

  let { isHydratable }: { isHydratable?: boolean } = $props();

  // For SSR-only (plain HTML) renders, read the form action result so the
  // confirmation / error survives the page re-render after a POST.
  // svelte-ignore state_referenced_locally
  const _form = !isHydratable && isServer ? getRequestContext().form : null;
  const _sentSubject = _form?.ok && typeof _form.data?.subject === 'string' ? _form.data.subject : null;
  const _failError = _form && !_form.ok && typeof _form.data?.error === 'string' ? _form.data.error : null;

  type SendData = { preset: string; subject: string };
  type FailData = { error: string };

  let sentSubject = $state<string | null>(_sentSubject);
  let errorMessage = $state<string | null>(_failError);
  let pending = $state(false);

  const handleSend: MochiSubmitFunction<SendData, FailData> = () => {
    errorMessage = null;
    return ({ result }) => {
      if (result.type === 'success' && result.data) {
        sentSubject = result.data.subject;
        errorMessage = null;
      } else if (result.type === 'failure' && result.data) {
        errorMessage = result.data.error;
      } else if (result.type === 'error') {
        errorMessage = 'Network error. Try again.';
      }
    };
  };

  const sendOpts: MochiEnhanceOptions<SendData, FailData> = {
    submit: handleSend,
    onPending: (v) => {
      pending = v;
    },
  };

  function reset() {
    sentSubject = null;
    errorMessage = null;
  }
</script>

{#if sentSubject}
  <div class="sent">
    <p>✅ Sent <strong>“{sentSubject}”</strong> to {DEMO_TO}.{isHydratable ? ' No page reload happened.' : ''}</p>
    <p>
      <a class="outbox-link" href="/_mochi/email" target="_blank" rel="noopener">View it in the dev outbox →</a>
    </p>
    <button type="button" class="secondary" onclick={reset}>Send another</button>
  </div>
{:else}
  <form method="POST" action="?/send" class="send" {@attach enhance(sendOpts)}>
    <p class="recipient">To: <strong>{DEMO_TO}</strong> <span class="fixed-note">(fixed — you pick the message, not the address)</span></p>
    <fieldset disabled={pending}>
      <legend>Choose a pre-written email</legend>
      {#each EMAIL_PRESETS as preset, i (preset.id)}
        <label class="option">
          <input type="radio" name="preset" value={preset.id} required checked={i === 0} />
          <span class="option-body">
            <span class="option-label">{preset.label}</span>
            <span class="option-blurb">{preset.blurb}</span>
          </span>
        </label>
      {/each}
    </fieldset>
    <div class="submit-row">
      <button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send email'}</button>
      {#if errorMessage}
        <p class="error" role="alert">{errorMessage}</p>
      {/if}
    </div>
  </form>
{/if}

<style>
  .send {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .recipient {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .fixed-note {
    color: var(--text-subtle);
    font-size: 0.8rem;
  }

  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.75rem 1rem 1rem;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  fieldset:disabled {
    opacity: 0.5;
  }

  legend {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    padding: 0 0.35rem;
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .option:hover {
    border-color: var(--accent);
  }

  .option input {
    margin-top: 0.2rem;
  }

  .option-body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .option-label {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }

  .option-blurb {
    font-size: 0.82rem;
    color: var(--text-subtle);
  }

  button {
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

  button:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  button.secondary {
    background: var(--surface-muted);
    color: var(--text);
    border-color: var(--border);
  }

  button.secondary:hover:not(:disabled) {
    background: var(--surface);
    border-color: var(--accent);
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

  .sent {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }

  .sent p {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-muted);
  }

  .outbox-link {
    color: var(--accent);
    font-weight: 600;
    text-decoration: none;
  }

  .outbox-link:hover {
    text-decoration: underline;
  }
</style>
