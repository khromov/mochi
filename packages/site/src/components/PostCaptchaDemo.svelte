<script lang="ts">
  import { onMount } from 'svelte';
  import { MochiCaptcha } from 'mochi-framework/components';

  // The challenge is minted out of band rather than in `serverProps` so the
  // generic /blog/:slug route stays free of post-specific plumbing.
  let token = $state('');
  let bits = $state(16);
  let verified = $state(false);
  let checking = $state(false);
  let result = $state<{ ok: boolean; message: string } | null>(null);
  let form: HTMLFormElement | undefined = $state();

  async function mint() {
    verified = false;
    // Trailing slashes: this site is `trailingSlash: 'always'`, so the bare paths 301/308.
    const res = await fetch('/api/captcha-demo/mint/', { cache: 'no-store' });
    const minted = (await res.json()) as { token: string; bits: number };
    token = minted.token;
    bits = minted.bits;
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
    const res = await fetch('/api/captcha-demo/verify/', {
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
  {#key token}
    <MochiCaptcha {token} {bits} bind:verified />
  {/key}
  <div class="row">
    <button type="submit" disabled={checking}>{checking ? 'Verifying…' : 'Verify on the server'}</button>
    {#if result}
      <p class="result" class:ok={result.ok}>{result.message}</p>
    {/if}
  </div>
</form>

<style>
  .captcha-demo {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem;
    margin: 1.25rem 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  button {
    background: var(--accent);
    color: #fff;
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
