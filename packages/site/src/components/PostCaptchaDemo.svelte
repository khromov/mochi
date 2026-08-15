<script lang="ts">
  import { onMount } from 'svelte';
  import { MochiCaptcha } from 'mochi-framework/components';

  // The challenge is minted out of band rather than in `serverProps` so the
  // generic /blog/:slug route stays free of post-specific plumbing.
  let token = $state('');
  let bits = $state(16);
  let solveBudgetMs = $state<number | undefined>();
  let verified = $state(false);
  let checking = $state(false);
  let result = $state<{ ok: boolean; message: string } | null>(null);
  let form: HTMLFormElement | undefined = $state();

  async function mint() {
    verified = false;
    // Trailing slashes: this site is `trailingSlash: 'always'`, so the bare paths 301/308.
    const res = await fetch('/api/captcha-demo/mint', { cache: 'no-store' });
    const minted = (await res.json()) as { token: string; bits: number; solveBudgetMs: number };
    token = minted.token;
    bits = minted.bits;
    solveBudgetMs = minted.solveBudgetMs;
  }

  onMount(mint);

  async function check(event: SubmitEvent) {
    event.preventDefault();
    if (!form) {
      return;
    }
    checking = true;
    result = null;
    const data = new FormData(form);
    const res = await fetch('/api/captcha-demo/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: data.get('captcha_token'), pow: data.get('captcha_pow') }),
    });
    const verdict = (await res.json()) as { ok: boolean; error?: string };
    checking = false;
    result = verdict.ok ? { ok: true, message: 'verifyCaptcha() accepted the proof — token consumed.' } : { ok: false, message: verdict.error ?? 'Verification failed.' };
    // Either way the token is spent: a pass burns the nonce, a fail earns a fresh challenge.
    await mint();
  }
</script>

<form class="captcha-demo" bind:this={form} onsubmit={check}>
  <!-- The mint is a round trip, so hold the track's height until a token lands —
       mounting the widget tokenless trips its own misconfiguration check. -->
  {#if token}
    {#key token}
      <MochiCaptcha {token} {bits} {solveBudgetMs} bind:verified />
    {/key}
  {:else}
    <div class="captcha-pending"></div>
  {/if}
  <div class="row">
    <button type="submit" disabled={checking}>{checking ? 'Verifying…' : 'Verify on the server'}</button>
    {#if result}
      <p class="result" class:ok={result.ok}>{result.message}</p>
    {/if}
  </div>
</form>

<style>
  .captcha-demo {
    /* The widget's own defaults are a fixed light palette; map them onto the site
       tokens so it follows the light/dark theme like everything else. */
    --mochi-captcha-track-bg: var(--surface-muted);
    --mochi-captcha-border: var(--border);
    --mochi-captcha-handle-bg: var(--surface);
    --mochi-captcha-handle-text: var(--text);
    --mochi-captcha-hint-text: var(--text-muted);
    --mochi-captcha-accent: var(--accent);
    --mochi-captcha-accent-soft: var(--accent-soft);
    --mochi-captcha-accent-soft-text: var(--accent-soft-text);
    --mochi-captcha-radius: var(--radius-md);

    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem;
    margin: 1.25rem 0;
  }

  .captcha-pending {
    min-height: 44px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  button {
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    border-radius: var(--radius-md);
    padding: 0.45rem 0.9rem;
    font-size: 0.85rem;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .result {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .result.ok {
    color: var(--accent);
  }
</style>
