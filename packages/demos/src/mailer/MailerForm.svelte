<script lang="ts">
  import { enhance, isServer, getRequestContext } from 'mochi-framework';
  import type { MochiEnhanceOptions, MochiSubmitFunction } from 'mochi-framework';

  type SendData = { to: string; subject: string; template: string };
  type FailData = { error: string };

  // Reading the last action result off the request context lets a plain
  // (no-JS) POST redisplay the outcome after the full-page reload, the same
  // way the confirmation shows up once `enhance` intercepts the submit.
  const _form = isServer ? getRequestContext().form : null;
  const _sent: SendData | null =
    _form?.ok && typeof _form.data?.to === 'string' && typeof _form.data?.subject === 'string' && typeof _form.data?.template === 'string'
      ? { to: _form.data.to, subject: _form.data.subject, template: _form.data.template }
      : null;
  const _failError = _form && !_form.ok && typeof _form.data?.error === 'string' ? _form.data.error : null;

  let sent = $state<SendData | null>(_sent);
  let errorMessage = $state<string | null>(_failError);
  let pending = $state(false);

  const handleSend: MochiSubmitFunction<SendData, FailData> = () => {
    errorMessage = null;
    return ({ result }) => {
      if (result.type === 'success' && result.data) {
        sent = result.data;
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
    sent = null;
    errorMessage = null;
  }
</script>

{#if sent}
  <div class="sent">
    <p>
      ✅ Sent <strong>“{sent.subject}”</strong> to <strong>{sent.to}</strong> using the <strong>{sent.template}</strong>
      template.
    </p>
    <button type="button" class="send-another" onclick={reset}>Send another</button>
  </div>
{:else}
  <form method="POST" action="?/send" class="mailer" {@attach enhance(sendOpts)}>
    <fieldset disabled={pending}>
      <label class="field">
        <span>To</span>
        <input type="email" name="to" required placeholder="you@example.com" />
      </label>
      <label class="field">
        <span>Subject</span>
        <input type="text" name="subject" required placeholder="Hello from Mochi" />
      </label>
      <label class="field">
        <span>Message</span>
        <textarea name="message" required rows="5" placeholder="Write something..."></textarea>
      </label>
      <div class="templates">
        <span class="templates-label">Template</span>
        <label class="option"><input type="radio" name="template" value="text" checked /> Plain text</label>
        <label class="option"><input type="radio" name="template" value="html" /> Raw HTML</label>
        <label class="option"><input type="radio" name="template" value="svelte" /> Svelte component</label>
      </div>
      <div class="submit-row">
        <button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send email'}</button>
        {#if errorMessage}
          <p class="error" role="alert">{errorMessage}</p>
        {/if}
      </div>
    </fieldset>
  </form>
{/if}

<style>
  .mailer {
    display: flex;
    flex-direction: column;
  }

  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  fieldset:disabled {
    opacity: 0.6;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: #4a4458;
  }

  input,
  textarea {
    font: inherit;
    padding: 0.55rem 0.75rem;
    border: 1px solid #e0dae8;
    border-radius: 8px;
    color: #1f1533;
    background: #fff;
  }

  input:focus,
  textarea:focus {
    outline: 2px solid #7c3aed;
    outline-offset: 1px;
    border-color: #7c3aed;
  }

  textarea {
    resize: vertical;
  }

  .templates {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1.25rem;
  }

  .templates-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #4a4458;
  }

  .option {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.9rem;
    font-weight: 500;
    color: #3f3a4d;
    cursor: pointer;
  }

  .submit-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  button {
    align-self: flex-start;
    padding: 0.55rem 1.2rem;
    background: linear-gradient(135deg, #7c3aed 0%, #d6336c 100%);
    color: #fff;
    border: 0;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error {
    margin: 0;
    font-size: 0.85rem;
    color: #c81e4a;
  }

  .sent {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .sent p {
    margin: 0;
    font-size: 0.95rem;
    color: #3f3a4d;
  }

  .send-another {
    padding: 0.5rem 1rem;
    background: #f4f0ff;
    color: #1f1533;
    border: 1px solid #e0dae8;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }
</style>
