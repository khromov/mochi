<script lang="ts">
  import { onMount } from 'svelte';
  import { MochiCaptcha } from 'mochi-framework/components';
  import type { MintedCaptcha } from 'mochi-framework';

  let { captcha }: { captcha: MintedCaptcha } = $props();

  // A token whose first chain link is made to throw. sha256Hex() cannot fail on
  // its own, so the only way to see the "hash chain failed" branch is to break
  // the hasher — scoped to inputs derived from this token so the other widgets
  // on the page keep hashing normally.
  const BOOM_TOKEN = 'mochi-boom-token';

  onMount(() => {
    const original = TextEncoder.prototype.encode;
    TextEncoder.prototype.encode = function (input?: string) {
      if (typeof input === 'string' && input.startsWith(BOOM_TOKEN)) {
        throw new Error('simulated digest failure');
      }
      return original.call(this, input);
    } as typeof original;
    return () => {
      TextEncoder.prototype.encode = original;
    };
  });
</script>

<div class="cases">
  <section>
    <h2>1. Proof-of-work ran out of budget</h2>
    <p>
      <code>bits={32}</code> against a 30s active-solve budget: unsolvable in time. Slide it, watch the hint start counting attempts once the solve passes two seconds, then land on
      a <strong>retry button</strong> after ~30s. Tapping it resumes the nonce search where it stopped rather than replaying it.
    </p>
    <MochiCaptcha {...captcha} bits={32} label="Slide — this one will give up" />
  </section>

  <section>
    <h2>2. The hash chain threw</h2>
    <p>Same retryable branch, reached the other way: the digest throws on the first link. Slide it a pixel and it fails immediately.</p>
    <MochiCaptcha token={BOOM_TOKEN} label="Slide — the hasher is rigged to throw" />
  </section>

  <section>
    <h2>3. Missing token</h2>
    <p>
      <code>{'{...captcha}'}</code> not spread. Caught at mount — no slide needed — and <strong>not retryable</strong>, so there is no button. In dev the cause renders verbatim; in
      production this slot is empty and the cause stays in the console.
    </p>
    <MochiCaptcha />
  </section>

  <section>
    <h2>4. bits outside 1–32</h2>
    <p>Same non-retryable configuration branch, caught at mount.</p>
    <MochiCaptcha {...captcha} bits={99} />
  </section>
</div>

<p class="note">
  Every case above logs through the framework logger at <code>error</code> level — check the console. All four widgets submit empty <code>captcha_token</code> /
  <code>captcha_pow</code>, so the server would reject them as unsolved.
</p>

<style>
  .cases {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    max-width: 30rem;

    --mochi-captcha-accent: var(--accent);
    --mochi-captcha-accent-soft: var(--accent-soft);
    --mochi-captcha-accent-soft-text: var(--accent-soft-text);
    --mochi-captcha-border: var(--border);
    --mochi-captcha-track-bg: var(--surface-muted);
    --mochi-captcha-handle-bg: var(--surface);
    --mochi-captcha-hint-text: var(--text-subtle);
  }

  h2 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
  }

  p {
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .note {
    max-width: 30rem;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    font-size: 0.85rem;
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
</style>
