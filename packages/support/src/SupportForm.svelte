<script lang="ts">
  import { enhance, isServer, getRequestContext } from 'mochi-framework';
  import type { MochiEnhanceOptions, MochiSubmitFunction } from 'mochi-framework';
  import SlideCaptcha from './components/SlideCaptcha.svelte';

  let { isHydratable }: { isHydratable?: boolean } = $props();

  // For SSR-only (plain HTML) renders, read the form action result so the
  // confirmation / error survives the page re-render after a POST.
  // svelte-ignore state_referenced_locally
  const _form = !isHydratable && isServer ? getRequestContext().form : null;
  const _failError = _form && !_form.ok && typeof _form.data?.error === 'string' ? _form.data.error : null;

  type FailData = { error: string };

  let sent = $state(Boolean(_form?.ok));
  let errorMessage = $state<string | null>(_failError);
  let pending = $state(false);

  const handleSend: MochiSubmitFunction<Record<string, never>, FailData> = () => {
    errorMessage = null;
    return ({ result }) => {
      if (result.type === 'success') {
        sent = true;
        errorMessage = null;
      } else if (result.type === 'failure' && result.data) {
        errorMessage = result.data.error;
      } else if (result.type === 'error') {
        errorMessage = 'Network error. Try again.';
      }
    };
  };

  const sendOpts: MochiEnhanceOptions<Record<string, never>, FailData> = {
    submit: handleSend,
    onPending: (v) => {
      pending = v;
    },
  };

  let solved = $state(false);

  function reset() {
    sent = false;
    errorMessage = null;
    // The captcha unmounts with the form, but `solved` outlives it — a fresh
    // SlideCaptcha would otherwise mount pre-verified with its handle at rest.
    solved = false;
  }
</script>

{#if sent}
  <div class="sent">
    <p>✅ Thanks — your message has been sent. We'll get back to you soon.</p>
    {#if isHydratable}
      <button type="button" class="send-another" onclick={reset}>Send another message</button>
    {:else}
      <a class="send-another" href="/">Send another message</a>
    {/if}
  </div>
{:else}
  <form method="POST" action="?/send" class="support-form" {@attach enhance(sendOpts)}>
    <fieldset disabled={pending}>
      <label>
        <span>Name</span>
        <input type="text" name="name" autocomplete="name" maxlength="200" />
      </label>
      <label>
        <span>Email</span>
        <input type="email" name="email" autocomplete="email" required />
      </label>
      <label>
        <span>How can we help?</span>
        <textarea name="message" rows="5" maxlength="5000" required></textarea>
      </label>
    </fieldset>

    <SlideCaptcha bind:solved />

    <div class="submit-row">
      <button type="submit" disabled={pending || !solved}>{pending ? 'Sending…' : 'Send message'}</button>
      {#if errorMessage}
        <p class="error" role="alert">{errorMessage}</p>
      {/if}
    </div>
  </form>
{/if}

<style>
  .support-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  fieldset:disabled {
    opacity: 0.5;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  label span {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  input[type='text'],
  input[type='email'],
  textarea {
    padding: 0.5rem 0.7rem;
    font-family: inherit;
    font-size: 0.95rem;
    color: var(--text);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  input:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  textarea {
    resize: vertical;
  }

  .submit-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  button[type='submit'] {
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

  button[type='submit']:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  button[type='submit']:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
    color: var(--text-muted);
  }

  .send-another {
    padding: 0.5rem 1rem;
    background: var(--surface-muted);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }

  .send-another:hover {
    background: var(--surface);
    border-color: var(--accent);
  }
</style>
