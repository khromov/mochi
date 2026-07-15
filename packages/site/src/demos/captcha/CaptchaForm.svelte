<script lang="ts">
  import { enhance } from 'mochi-framework';
  import type { MochiSubmitFunction, MintedCaptcha } from 'mochi-framework';
  import { MochiCaptcha } from 'mochi-framework/components';

  let { captcha }: { captcha: MintedCaptcha } = $props();

  let errorMessage = $state<string | null>(null);
  let sentMessage = $state<string | null>(null);
  let pending = $state(false);

  const handleSubmit: MochiSubmitFunction = () => {
    pending = true;
    errorMessage = null;
    return ({ result }) => {
      pending = false;
      if (result.type === 'success') {
        sentMessage = (result.data as { message?: string })?.message ?? 'Verified.';
      } else if (result.type === 'failure') {
        errorMessage = (result.data as { error?: string })?.error ?? 'Verification failed.';
      }
    };
  };
</script>

{#if sentMessage}
  <div class="sent">
    <p>✅ {sentMessage}</p>
    <!-- A full navigation, not a state reset: the token minted at SSR is
         single-use and this submit burned it — a reload mints a fresh one. -->
    <a href="/demos/captcha/">Reload for a fresh challenge</a>
  </div>
{:else}
  <form method="POST" action="?/submit" {@attach enhance(handleSubmit)}>
    <label>
      <span>Your name</span>
      <input name="name" autocomplete="name" />
    </label>

    <MochiCaptcha {...captcha} />

    {#if errorMessage}
      <p class="error" role="alert">{errorMessage}</p>
    {/if}

    <!-- Deliberately not gated on the captcha, so you can submit unsolved and
         watch the server reject it. Real forms should disable until verified. -->
    <button type="submit" disabled={pending}>{pending ? 'Checking…' : 'Submit'}</button>
  </form>
{/if}

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    max-width: 26rem;
    margin-top: 0.75rem;

    /* The widget's own defaults are light-only; map the site palette onto them
       so it follows the theme toggle. */
    --mochi-captcha-accent: var(--accent);
    --mochi-captcha-accent-soft: var(--accent-soft);
    --mochi-captcha-accent-soft-text: var(--accent-soft-text);
    --mochi-captcha-border: var(--border);
    --mochi-captcha-track-bg: var(--surface-muted);
    --mochi-captcha-handle-bg: var(--surface);
    --mochi-captcha-hint-text: var(--text-subtle);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  input {
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    font-size: 0.95rem;
  }

  input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .error {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: var(--badge-danger-bg);
    color: var(--badge-danger-text);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
  }

  .sent {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
    margin-top: 0.75rem;
    font-size: 0.95rem;
  }

  .sent p {
    margin: 0;
  }

  .sent a {
    font-size: 0.85rem;
    color: var(--accent);
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

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  button:hover:not(:disabled) {
    background: var(--accent-hover);
  }
</style>
