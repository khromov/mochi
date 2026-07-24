<script lang="ts">
  import { onMount } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { logger, isDev } from 'mochi-framework';
  import { CAPTCHA_STEPS, DEFAULT_CAPTCHA_SOLVE_BUDGET_MS, CAPTCHA_SOLVE_SLICE_MS, chainInput, sha256Hex, solvePowSlice } from './pow';

  const PROGRESS_AFTER_MS = 2000;
  const PROGRESS_INTERVAL_MS = 1000;

  let {
    token = '',
    bits = 16,
    solveBudgetMs = DEFAULT_CAPTCHA_SOLVE_BUDGET_MS,
    emoji = '🧩',
    label = 'Slide to verify',
    verifyingLabel = 'Verifying…',
    verifiedLabel = 'Verified — thanks!',
    errorLabel = 'Verification failed — tap to try again',
    verified = $bindable(false),
  }: {
    token?: string;
    bits?: number;
    solveBudgetMs?: number;
    emoji?: string;
    label?: string;
    verifyingLabel?: string;
    verifiedLabel?: string;
    errorLabel?: string;
    verified?: boolean;
  } = $props();

  let solved = $state(false);
  let powNonce = $state<string | null>(null);
  let error = $state<string | null>(null);
  // A configuration mistake can't be retried into working, so it gets no retry
  // affordance.
  let errorRetryable = $state(false);

  // null means "not showing". Published on an interval rather than per slice:
  // it sits in an aria-live region and slices land every few milliseconds.
  let progressAttempts = $state<number | null>(null);

  // A misconfiguration is for the developer, not the visitor: shown in dev,
  // and in production degraded to the same empty slot as a captcha that never
  // hydrated, with the cause left in the console by `failWith`.
  const suppressed = $derived(error !== null && !errorRetryable && !isDev);

  // The widget is inert without JavaScript — the slider, the hash chain and the
  // proof-of-work all run client-side. Render nothing on the server and reveal it
  // only once it actually mounts in the browser, so a captcha that was never
  // hydrated (no `mochi:hydrate` on itself and no hydrated ancestor subtree)
  // degrades to an empty slot instead of a dead, non-interactive slider. onMount
  // runs only client-side, so the first (SSR + initial hydration) render is empty
  // for both and the reveal is a post-hydration update — no hydration mismatch.
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
    // At mount, not when the chain completes: a widget wired up wrong should say
    // so before the visitor drags anything.
    validateProps();
  });

  // The PoW challenge is a hash chain advanced one link per slider step: each
  // step crossed emits chain = sha256(`${chain}:step${i}`). The final link is
  // the PoW input, so the answer is only derivable by actually running the
  // slide progression — it never appears in the page or the island props.
  // The token is minted once at SSR and never changes for the island's lifetime.
  // svelte-ignore state_referenced_locally
  let chain = token;
  let claimedSteps = 0;

  // Bumped on teardown and on retry. Every scheduled slice checks it before
  // touching state, so a stale solve can neither write to a live widget nor —
  // the failure this replaces — leave a live one stranded on "Verifying…".
  let generation = 0;
  let solveTimer: ReturnType<typeof setTimeout> | null = null;

  // Where the nonce search resumes after a retry. The token never changes, so
  // the search is deterministic — restarting at 0 would replay the attempts that
  // just failed and an exhausted budget could never resolve itself.
  let powResumeFrom = 0;

  $effect(() => () => {
    cancelSolve();
  });

  const causeOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

  function cancelSolve() {
    generation++;
    if (solveTimer !== null) {
      clearTimeout(solveTimer);
      solveTimer = null;
    }
  }

  /**
   * The one way this widget is allowed to stop working. Every path that could
   * strand it lands here, so a failure is never a permanent "Verifying…" with
   * nothing in the console. `retryable` is false only for a misconfiguration,
   * which re-running would reproduce exactly.
   */
  function failWith(detail: string, retryable = true) {
    cancelSolve();
    error = detail;
    errorRetryable = retryable;
    solved = false;
    powNonce = null;
    progressAttempts = null;
    // Swapping in the error UI removes the handle, so the pointerup that would
    // have released the drag never arrives. Without this the retried slider
    // ignores every subsequent pointerdown — observed in the browser.
    activePointer = null;
    // `error` level, so it survives the production default of `warn`.
    logger.error(`captcha: ${detail}`);
  }

  /** Mirrors the server's own bounds in `resolveCaptchaOptions` — keep in step. */
  function validateProps(): boolean {
    if (!token) {
      failWith('No token — spread the result of mintCaptcha() onto <MochiCaptcha />', false);
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
    return true;
  }

  function retry() {
    cancelSolve();
    chain = token;
    claimedSteps = 0;
    progressAttempts = null;
    activePointer = null;
    offset = 0;
    solved = false;
    powNonce = null;
    error = null;
    errorRetryable = false;
    // `powResumeFrom` deliberately survives: see its declaration.
  }

  function emitSteps() {
    if (maxOffset <= 0 || error !== null) {
      return;
    }
    const target = solved ? CAPTCHA_STEPS : Math.min(Math.floor((offset / maxOffset) * CAPTCHA_STEPS), CAPTCHA_STEPS);
    try {
      while (claimedSteps < target) {
        const step = ++claimedSteps;
        chain = sha256Hex(chainInput(chain, step));
        // Logged through the framework logger, so it is level-gated: visible at
        // `log` level (the dev default) and silent in production.
        logger.log(`captcha: link ${step}/${CAPTCHA_STEPS} minted — ${chain.slice(0, 16)}…`);
      }
    } catch (e) {
      failWith(`Hash chain failed at link ${claimedSteps}/${CAPTCHA_STEPS} — ${causeOf(e)}`);
      return;
    }
    if (claimedSteps === CAPTCHA_STEPS && powNonce === null && solveTimer === null) {
      startSolve(chain);
    }
  }

  function startSolve(challenge: string) {
    logger.log(`captcha: chain complete, solving ${bits}-bit proof-of-work over ${challenge.slice(0, 16)}…`);

    const mine = generation;
    const startedAt = Date.now();
    // Active solve time, not wall clock: a backgrounded mobile tab stops
    // scheduling slices, and it must not be charged for time it never got.
    let spentMs = 0;
    let publishedMs = 0;
    let nonce = powResumeFrom;

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
        powNonce = result.nonce;
        progressAttempts = null;
        logger.log(`captcha: solved in ${Date.now() - startedAt}ms — nonce ${result.nonce} after ${Number(result.nonce) + 1} attempts`);
        return;
      }
      nonce = result.next;
      powResumeFrom = nonce;
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

  $effect(() => {
    verified = solved && powNonce !== null;
  });

  const HANDLE = 44;
  let maxOffset = $state(0);
  let offset = $state(0);
  // The id of the pointer that owns the drag. A touch device can deliver a
  // second pointerdown mid-drag (a stray finger, a palm); without this it would
  // reseat pointerStart and jump the handle backwards.
  let activePointer: number | null = null;
  let pointerStart = 0;
  let offsetStart = 0;

  // ResizeObserver fires once on observe, so this also seeds the initial measure.
  const measureTrack: Attachment<HTMLDivElement> = (node) => {
    const observer = new ResizeObserver(() => {
      maxOffset = node.clientWidth - HANDLE;
    });
    observer.observe(node);
    return () => observer.disconnect();
  };

  function settle() {
    // maxOffset is 0 until the track is measured — never treat that as solved.
    if (maxOffset > 0 && offset >= maxOffset - 2) {
      solved = true;
      offset = maxOffset;
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (solved || error !== null || activePointer !== null) {
      return;
    }
    activePointer = e.pointerId;
    pointerStart = e.clientX;
    offsetStart = offset;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Firefox throws InvalidPointerId if the pointer is already gone. Touch
      // pointers are implicitly captured anyway, so the drag still works —
      // what must not happen is this throwing out of the handler.
    }
  }

  function applyPointer(e: PointerEvent) {
    offset = Math.min(Math.max(offsetStart + e.clientX - pointerStart, 0), maxOffset);
  }

  function onPointerMove(e: PointerEvent) {
    if (activePointer !== e.pointerId || solved) {
      return;
    }
    applyPointer(e);
    settle();
    emitSteps();
  }

  function releasePointer(e: PointerEvent): boolean {
    if (activePointer !== e.pointerId) {
      return false;
    }
    activePointer = null;
    return true;
  }

  function onPointerUp(e: PointerEvent) {
    if (!releasePointer(e) || solved) {
      return;
    }
    // Moves coalesce, so the lift-off can sit past where the last one left us.
    // Applying its position is what rescues a finger lifting a pixel short of
    // the end — settling against the stale move offset decides nothing.
    applyPointer(e);
    settle();
    emitSteps();
    if (!solved) {
      offset = 0;
    }
  }

  // A cancelled gesture is one the visitor didn't complete, so unlike a lift-off
  // it must not settle into `solved`.
  function onPointerCancel(e: PointerEvent) {
    if (!releasePointer(e)) {
      return;
    }
    if (!solved) {
      offset = 0;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (solved || error !== null) {
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      offset = Math.min(offset + maxOffset / 10, maxOffset);
      settle();
      emitSteps();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      offset = Math.max(offset - maxOffset / 10, 0);
    }
  }
</script>

{#if mounted && !suppressed}
  <div class="captcha" class:solved class:verified class:errored={error !== null}>
    {#if error !== null && errorRetryable}
      <!-- A real button rather than the slider in an error skin: tap, Enter and
           Space all reset the widget for free. The cause underneath is
           developer-facing, so it stays in dev. -->
      <button type="button" class="track error-box" onclick={retry}>
        <span class="captcha-hint" role="alert">
          {errorLabel}
          {#if isDev}<small>{error}</small>{/if}
        </span>
      </button>
    {:else if error !== null}
      <!-- Dev only (see `suppressed`): no retry affordance, because retrying
           reproduces a configuration mistake exactly. -->
      <div class="track error-box">
        <span class="captcha-hint" role="alert"><small>{error}</small></span>
      </div>
    {:else}
      <div class="track" {@attach measureTrack}>
        <div class="fill" style="width: {offset + HANDLE}px"></div>
        <div
          class="handle"
          style="transform: translateX({offset}px)"
          role="slider"
          tabindex={solved ? -1 : 0}
          aria-label={label}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={solved ? 100 : Math.round((offset / Math.max(maxOffset, 1)) * 100)}
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerCancel}
          onkeydown={onKeyDown}
        >
          {emoji}
        </div>
        <span class="captcha-hint" aria-live="polite">
          {#if verified}
            {verifiedLabel}
          {:else if solved}
            {verifyingLabel}
            <!-- Out of the live region: the state change is worth announcing,
                 a ticking number isn't. -->
            {#if progressAttempts !== null}<span aria-hidden="true">&nbsp;({progressAttempts.toLocaleString()} attempts)</span>{/if}
          {:else}
            {label}
          {/if}
        </span>
      </div>
    {/if}
  </div>
  <input type="hidden" name="captcha_token" value={verified ? token : ''} />
  <input type="hidden" name="captcha_pow" value={verified ? powNonce : ''} />
{/if}

<style>
  /* Defaults live in each var()'s fallback, not in a declaration on .captcha:
     a value set here would sit on the element itself and beat anything the host
     inherits down from an ancestor, so the theming vars could never be
     overridden. */
  .captcha .track {
    position: relative;
    height: 44px;
    border: 1px solid var(--mochi-captcha-border, #e8e4d8);
    border-radius: var(--mochi-captcha-radius, 999px);
    background: var(--mochi-captcha-track-bg, #faf8f1);
    overflow: hidden;
  }

  .captcha .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--mochi-captcha-accent-soft, #e0ebe1);
    border-radius: var(--mochi-captcha-radius, 999px);
  }

  .captcha .handle {
    position: absolute;
    inset: 0 auto 0 0;
    width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.35rem;
    border-radius: var(--mochi-captcha-radius, 999px);
    background: var(--mochi-captcha-handle-bg, #fffdf8);
    border: 1px solid var(--mochi-captcha-accent, #4a7c59);
    /* Defaulting to the accent keeps the glyph legible for free: the accent is
       already drawn on the handle background as its border, so contrast between
       the two is a requirement the host has met. Only affects text-presentation
       glyphs — colour-font emoji ignore it. */
    color: var(--mochi-captcha-handle-text, var(--mochi-captcha-accent, #4a7c59));
    cursor: grab;
    touch-action: none;
    user-select: none;
    z-index: 1;
  }

  .captcha .handle:active {
    cursor: grabbing;
  }

  .captcha.solved .handle {
    cursor: default;
  }

  .captcha-hint {
    position: absolute;
    inset: 0;
    /* Keep the hint clear of the 44px handle at either end of the track. */
    padding: 0 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    line-height: 1.2;
    font-size: 0.85rem;
    color: var(--mochi-captcha-hint-text, #6e756d);
    pointer-events: none;
  }

  .captcha.verified .captcha-hint {
    color: var(--mochi-captcha-accent-soft-text, #2f5b3f);
    font-weight: 600;
  }

  /* Grows past the track's 44px because the diagnostic is a second line, and
     centres within it when one line doesn't fill the 44px floor. */
  .captcha .error-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: auto;
    min-height: 44px;
    padding: 8px 12px;
    text-align: center;
    background: var(--mochi-captcha-error-bg, #fdf3f2);
    border-color: var(--mochi-captcha-error-border, #e9c9c4);
  }

  /* Only the retryable variant is a button, and it has to shed the UA styling
     for the .track rule above to land. */
  .captcha button.error-box {
    font: inherit;
    cursor: pointer;
  }

  .captcha .error-box .captcha-hint {
    position: static;
    padding: 0;
    flex-direction: column;
    gap: 2px;
  }

  .captcha.errored .captcha-hint {
    color: var(--mochi-captcha-error-text, #8a3324);
    font-weight: 600;
  }

  .captcha.errored .captcha-hint small {
    font-size: 0.75rem;
    font-weight: 400;
    opacity: 0.85;
  }
</style>
