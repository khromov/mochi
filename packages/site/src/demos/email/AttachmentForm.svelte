<script lang="ts">
  import { enhance } from 'mochi-framework';
  import type { MochiEnhanceOptions, MochiSubmitFunction, MochiDirectives } from 'mochi-framework';
  import { ATTACHMENT, DEMO_TO } from './presets.ts';

  let {}: MochiDirectives = $props();

  // Hydrated-only demo: this island always ships JS, so the form submits through
  // {@attach enhance(...)} — there's no plain-HTML fallback branch to handle.
  type SendData = { filename: string };
  type FailData = { error: string };

  let sentFilename = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);
  let pending = $state(false);

  const handleSend: MochiSubmitFunction<SendData, FailData> = () => {
    errorMessage = null;
    return ({ result }) => {
      if (result.type === 'success' && result.data) {
        sentFilename = result.data.filename;
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
    sentFilename = null;
    errorMessage = null;
  }
</script>

{#if sentFilename}
  <div class="sent">
    <p>✅ Sent to {DEMO_TO} with <strong>{sentFilename}</strong> attached. No page reload happened.</p>
    <p>
      <a class="outbox-link" href="/_mochi/email" target="_blank" rel="noopener">View it in the dev outbox →</a>
    </p>
    <button type="button" class="send-another" onclick={reset}>Send another</button>
  </div>
{:else}
  <form method="POST" action="?/sendPhoto" class="send" {@attach enhance(sendOpts)}>
    <p class="recipient">To: <strong>{DEMO_TO}</strong></p>
    <div class="attachment">
      <img src={ATTACHMENT.previewUrl} alt="A mochi, ready to attach" width="120" height="80" />
      <span class="attach-meta">
        <span class="attach-name">📎 {ATTACHMENT.filename}</span>
        <span class="attach-note">rides along as a real file attachment</span>
      </span>
    </div>
    <div class="submit-row">
      <button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send email with attachment'}</button>
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

  .attachment {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
  }

  .attachment img {
    border-radius: var(--radius-sm);
    object-fit: cover;
    display: block;
  }

  .attach-meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .attach-name {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }

  .attach-note {
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

  .send-another {
    align-self: flex-start;
    padding: 0.5rem 1rem;
    background: var(--surface-muted);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }

  .send-another:hover {
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
