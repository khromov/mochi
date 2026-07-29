<script lang="ts">
  import { enhance, isServer, getRequestContext, isHydratable } from 'mochi-framework';
  import type { MochiEnhanceOptions, MochiSubmitFunction, MintedCaptcha } from 'mochi-framework';
  import { MochiCaptcha } from 'mochi-framework/components';

  let { captcha, source }: { captcha: MintedCaptcha; source: string } = $props();

  const hydratable = isHydratable();
  // SSR-only (plain HTML) renders read the action result so the confirmation or
  // error survives the page re-render after a POST.
  const _form = !hydratable && isServer ? getRequestContext().form : null;
  const _failError = _form && !_form.ok && typeof _form.data?.error === 'string' ? _form.data.error : null;

  type FailData = { error: string };

  let sent = $state(Boolean(_form?.ok));
  let errorMessage = $state<string | null>(_failError);
  let pending = $state(false);
  let verified = $state(false);

  const handleSubscribe: MochiSubmitFunction<Record<string, never>, FailData> = () => {
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

  const subscribeOpts: MochiEnhanceOptions<Record<string, never>, FailData> = {
    submit: handleSubscribe,
    onPending: (v) => {
      pending = v;
    },
  };
</script>

{#if sent}
  <div class="done">
    <p class="done-title">📬 Almost there</p>
    <p>Check your inbox and click the confirmation link. Nothing is sent until you do.</p>
  </div>
{:else}
  <form method="POST" action="?/subscribe" class="newsletter-form" {@attach enhance(subscribeOpts)}>
    <input type="hidden" name="source" value={source} />
    <!-- Honeypot. Positioned off-screen rather than display:none (which some bots
         detect), never required, and never focusable by a real visitor. -->
    <div class="hp" aria-hidden="true">
      <label for="website">Leave this field empty</label>
      <input id="website" type="text" name="website" tabindex="-1" autocomplete="off" />
    </div>

    <fieldset disabled={pending}>
      <label class="field">
        <span>Email</span>
        <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required />
      </label>
    </fieldset>

    <MochiCaptcha {...captcha} emoji="🍡" label="Slide the mochi to subscribe" bind:verified />

    <noscript><p class="error">JavaScript is required to subscribe.</p></noscript>

    <div class="submit-row">
      <button type="submit" disabled={pending || !verified}>{pending ? 'Subscribing…' : 'Subscribe'}</button>
    </div>
    <!-- Reserved rather than animated: the height is polled by sidechain every
         300ms, and a transition would have the iframe chase a moving target. -->
    <p class="message" role="alert">{errorMessage ?? ''}</p>
  </form>
{/if}

<style>
  .newsletter-form {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;

    --mochi-captcha-accent: var(--accent);
    --mochi-captcha-accent-soft: var(--accent-soft);
    --mochi-captcha-accent-soft-text: var(--accent-soft-text);
    --mochi-captcha-border: var(--border);
    --mochi-captcha-track-bg: var(--surface-muted);
    --mochi-captcha-handle-bg: var(--surface);
    --mochi-captcha-hint-text: var(--text-subtle);
  }

  .hp {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }

  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }

  fieldset:disabled {
    opacity: 0.5;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .field span {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  input[type='email'] {
    padding: 0.5rem 0.7rem;
    font-family: inherit;
    font-size: 0.95rem;
    color: var(--text);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .submit-row {
    display: flex;
  }

  button[type='submit'] {
    padding: 0.5rem 1.1rem;
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

  .message {
    margin: 0;
    min-height: 1.2rem;
    font-size: 0.9rem;
    color: var(--badge-danger-text);
  }

  .error {
    margin: 0;
    font-size: 0.9rem;
    color: var(--badge-danger-text);
  }

  .done {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .done-title {
    margin: 0;
    font-weight: 600;
  }

  .done p {
    margin: 0;
    color: var(--text-muted);
  }
</style>
