<script lang="ts">
  import { onMount } from 'svelte';
  import { logger, isDev } from 'mochi-framework';
  import { CAPTCHA_STEPS, DEFAULT_CAPTCHA_SOLVE_BUDGET_MS, CAPTCHA_SOLVE_SLICE_MS, chainInput, sha256Hex, solvePowSlice } from './pow';

  const PROGRESS_AFTER_MS = 2000;
  const PROGRESS_INTERVAL_MS = 1000;

  let {
    token = '',
    bits = 16,
    solveBudgetMs = DEFAULT_CAPTCHA_SOLVE_BUDGET_MS,
    verifyUrl = '',
    maxAttempts = 5,
    solvingLabel = 'Verifying your browser…',
    verifiedLabel = 'Verified — loading the page…',
    errorLabel = 'Verification failed',
    retryLabel = 'Try again',
    exhaustedLabel = "We couldn't verify your browser. Please try again later.",
    noscriptLabel = 'JavaScript is required to verify your browser.',
  }: {
    token?: string;
    bits?: number;
    solveBudgetMs?: number;
    verifyUrl?: string;
    maxAttempts?: number;
    solvingLabel?: string;
    verifiedLabel?: string;
    errorLabel?: string;
    retryLabel?: string;
    exhaustedLabel?: string;
    noscriptLabel?: string;
  } = $props();

  let phase = $state<'solving' | 'submitting' | 'verified' | 'error' | 'exhausted'>('solving');
  let error = $state<string | null>(null);
  // A configuration mistake can't be retried into working, so it gets no retry
  // affordance.
  let errorRetryable = $state(false);
  let progressAttempts = $state<number | null>(null);

  // Same degradation as MochiCaptcha: a misconfiguration is for the developer,
  // shown in dev and collapsed to the unhydrated spacer in production.
  const suppressed = $derived(phase === 'error' && !errorRetryable && !isDev);

  let mounted = $state(false);
  let generation = 0;
  let solveTimer: ReturnType<typeof setTimeout> | null = null;

  const causeOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // Attempts survive the reload each retry performs, so the count has to live outside the
  // document; sessionStorage scopes it to the tab and forgets it when the tab closes.
  const ATTEMPTS_KEY = 'mochi-protection-attempts';
  function readAttempts(): number {
    try {
      return Number(sessionStorage.getItem(ATTEMPTS_KEY)) || 0;
    } catch {
      return 0;
    }
  }
  function writeAttempts(count: number) {
    try {
      if (count <= 0) {
        sessionStorage.removeItem(ATTEMPTS_KEY);
      } else {
        sessionStorage.setItem(ATTEMPTS_KEY, String(count));
      }
    } catch {
      // Storage unavailable (privacy mode) — the visitor just keeps the retry affordance.
    }
  }

  // Stamped just before the post-verification reload. Finding it still fresh on the next mount means the server took
  // the solution and gated the page anyway, so reloading again would loop forever, re-solving on every pass.
  const VERIFIED_KEY = 'mochi-protection-verified';
  const BOUNCES_KEY = 'mochi-protection-bounces';
  const BOUNCE_WINDOW_MS = 60_000;
  const MAX_BOUNCES = 2;

  function markVerified() {
    try {
      sessionStorage.setItem(VERIFIED_KEY, String(Date.now()));
    } catch {
      // Storage unavailable — a bounce loop just goes undetected, as it did before.
    }
  }

  /** Reads and clears the marker, so a stale one left by a verification that did land can't fire a later challenge. */
  function takeVerifiedBounce(): boolean {
    try {
      const stamp = Number(sessionStorage.getItem(VERIFIED_KEY));
      sessionStorage.removeItem(VERIFIED_KEY);
      return stamp > 0 && Date.now() - stamp < BOUNCE_WINDOW_MS;
    } catch {
      return false;
    }
  }

  function readBounces(): number {
    try {
      return Number(sessionStorage.getItem(BOUNCES_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  function writeBounces(count: number): number {
    try {
      sessionStorage.setItem(BOUNCES_KEY, String(count));
    } catch {
      // Storage unavailable — the count just never accumulates.
    }
    return count;
  }

  function cancelSolve() {
    generation++;
    if (solveTimer !== null) {
      clearTimeout(solveTimer);
      solveTimer = null;
    }
  }

  function failWith(detail: string, retryable = true) {
    cancelSolve();
    phase = 'error';
    error = detail;
    errorRetryable = retryable;
    progressAttempts = null;
    logger.error(`captcha: ${detail}`);
    if (retryable) {
      const attempts = readAttempts() + 1;
      writeAttempts(attempts);
      if (attempts >= maxAttempts) {
        phase = 'exhausted';
      }
    }
  }

  /** Mirrors the server's own bounds in `resolveCaptchaOptions` — keep in step. */
  function validateProps(): boolean {
    if (!token) {
      failWith('No token — spread a minted captcha onto <MochiCaptchaAuto />', false);
      return false;
    }
    if (!verifyUrl) {
      failWith('No verifyUrl — <MochiCaptchaAuto /> needs the endpoint to submit the solution to', false);
      return false;
    }
    if (!Number.isInteger(bits) || bits < 1 || bits > 32) {
      failWith(`Bits must be an integer between 1 and 32, got ${bits}`, false);
      return false;
    }
    if (!Number.isFinite(solveBudgetMs) || solveBudgetMs <= 0) {
      failWith(`Solve budget must be a positive finite number of milliseconds, got ${solveBudgetMs}`, false);
      return false;
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      failWith(`Max attempts must be a positive integer, got ${maxAttempts}`, false);
      return false;
    }
    return true;
  }

  onMount(() => {
    mounted = true;
    // Reaching the interstitial without a just-completed verification means this is not a reload loop.
    const bounced = writeBounces(takeVerifiedBounce() ? readBounces() + 1 : 0);
    if (readAttempts() >= maxAttempts) {
      phase = 'exhausted';
    } else if (bounced >= MAX_BOUNCES) {
      phase = 'exhausted';
      logger.error('captcha: verification succeeded but the page is still gated — refusing to reload again');
    } else if (bounced > 0) {
      failWith('Verification succeeded but the page is still gated — the clearance cookie was refused');
    } else if (validateProps()) {
      startSolve();
    }
    return cancelSolve;
  });

  // The retry reloads rather than resuming: the failed token may be consumed or
  // expired server-side, and a fresh document carries a fresh challenge.
  function retry() {
    location.reload();
  }

  function startSolve() {
    // The visitor slides nothing here, so the whole chain is walked up front —
    // the server only cares that the progression actually ran.
    let challenge = token;
    try {
      for (let step = 1; step <= CAPTCHA_STEPS; step++) {
        challenge = sha256Hex(chainInput(challenge, step));
      }
    } catch (e) {
      failWith(`Hash chain failed — ${causeOf(e)}`);
      return;
    }
    logger.log(`captcha: chain complete, solving ${bits}-bit proof-of-work over ${challenge.slice(0, 16)}…`);

    const mine = generation;
    const startedAt = Date.now();
    // Active solve time, not wall clock: a backgrounded tab stops scheduling
    // slices and must not be charged for time it never got.
    let spentMs = 0;
    let publishedMs = 0;
    let nonce = 0;

    const step = () => {
      solveTimer = null;
      if (generation !== mine) {
        return;
      }
      const sliceStart = Date.now();
      let result;
      try {
        result = solvePowSlice(challenge, bits, nonce, CAPTCHA_SOLVE_SLICE_MS);
      } catch (e) {
        failWith(`Proof-of-work failed after ${nonce} attempts — ${causeOf(e)}`);
        return;
      }
      spentMs += Date.now() - sliceStart;

      if ('nonce' in result) {
        progressAttempts = null;
        logger.log(`captcha: solved in ${Date.now() - startedAt}ms — nonce ${result.nonce} after ${Number(result.nonce) + 1} attempts`);
        void submit(result.nonce, mine);
        return;
      }
      nonce = result.next;
      if (spentMs >= solveBudgetMs) {
        failWith(`Proof-of-work gave up after ${Math.round(spentMs / 1000)}s and ${nonce} attempts at ${bits} bits`);
        return;
      }
      if (spentMs >= PROGRESS_AFTER_MS && spentMs - publishedMs >= PROGRESS_INTERVAL_MS) {
        publishedMs = spentMs;
        progressAttempts = nonce;
      }
      solveTimer = setTimeout(step);
    };

    solveTimer = setTimeout(step);
  }

  async function submit(powNonce: string, mine: number) {
    phase = 'submitting';
    const body = new FormData();
    body.set('captcha_token', token);
    body.set('captcha_pow', powNonce);
    let res: Response;
    try {
      res = await fetch(verifyUrl, { method: 'POST', body });
    } catch (e) {
      if (generation === mine) {
        failWith(`Could not reach the verification endpoint — ${causeOf(e)}`);
      }
      return;
    }
    if (generation !== mine) {
      return;
    }
    if (!res.ok) {
      const detail = await res
        .json()
        .then((data: { error?: string }) => data.error)
        .catch(() => undefined);
      failWith(detail ?? `Verification endpoint answered ${res.status}`);
      return;
    }
    phase = 'verified';
    writeAttempts(0);
    markVerified();
    location.reload();
  }
</script>

{#if mounted && !suppressed}
  <div class="captcha-auto" class:errored={phase === 'error' || phase === 'exhausted'}>
    {#if phase === 'exhausted'}
      <div class="box error-box">
        <span class="status" role="alert">{exhaustedLabel}</span>
      </div>
    {:else if phase === 'error' && errorRetryable}
      <button type="button" class="box error-box" onclick={retry}>
        <span class="status" role="alert">
          {errorLabel} — {retryLabel}
          {#if isDev}<small>{error}</small>{/if}
        </span>
      </button>
    {:else if phase === 'error'}
      <!-- Dev only (see `suppressed`): no retry affordance, because retrying
           reproduces a configuration mistake exactly. -->
      <div class="box error-box">
        <span class="status" role="alert"><small>{error}</small></span>
      </div>
    {:else}
      <div class="box">
        <span class="spinner" class:done={phase === 'verified'} aria-hidden="true"></span>
        <span class="status" aria-live="polite">
          {phase === 'verified' ? verifiedLabel : solvingLabel}
          <!-- Out of the live region: the state change is worth announcing,
               a ticking number isn't. -->
          {#if progressAttempts !== null}<span aria-hidden="true">&nbsp;({progressAttempts.toLocaleString()} attempts)</span>{/if}
        </span>
      </div>
    {/if}
  </div>
{:else}
  <div class="captcha-placeholder">
    <noscript>{noscriptLabel}</noscript>
  </div>
{/if}

<style>
  .captcha-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    text-align: center;
    line-height: 1.2;
    font-size: 0.85rem;
    color: var(--mochi-captcha-hint-text, #6e756d);
  }

  .captcha-auto .box {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 44px;
    padding: 8px 16px;
    border: 1px solid var(--mochi-captcha-border, #e8e4d8);
    border-radius: var(--mochi-captcha-radius, 999px);
    background: var(--mochi-captcha-track-bg, #faf8f1);
  }

  .captcha-auto .spinner {
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: 50%;
    border: 2px solid var(--mochi-captcha-accent-soft, #e0ebe1);
    border-top-color: var(--mochi-captcha-accent, #4a7c59);
    animation: mochi-captcha-spin 0.8s linear infinite;
  }

  .captcha-auto .spinner.done {
    animation: none;
    border-color: var(--mochi-captcha-accent, #4a7c59);
  }

  @keyframes mochi-captcha-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .captcha-auto .spinner {
      animation-duration: 2.4s;
    }
  }

  .captcha-auto .status {
    text-align: center;
    line-height: 1.2;
    font-size: 0.85rem;
    color: var(--mochi-captcha-hint-text, #6e756d);
  }

  .captcha-auto .error-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: auto;
    min-height: 44px;
    padding: 8px 12px;
    text-align: center;
    background: var(--mochi-captcha-error-bg, #fdf3f2);
    border: 1px solid var(--mochi-captcha-error-border, #e9c9c4);
    border-radius: var(--mochi-captcha-radius, 999px);
  }

  .captcha-auto button.error-box {
    font: inherit;
    cursor: pointer;
  }

  .captcha-auto .error-box .status {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .captcha-auto.errored .status {
    color: var(--mochi-captcha-error-text, #8a3324);
    font-weight: 600;
  }

  .captcha-auto.errored .status small {
    font-size: 0.75rem;
    font-weight: 400;
    opacity: 0.85;
  }
</style>
