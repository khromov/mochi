<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import { CAPTCHA_STEPS, chainInput, powInput, leadingZeroBits, toHex } from './pow';

  let { token = '', bits = 16, verified = $bindable(false) }: { token?: string; bits?: number; verified?: boolean } = $props();

  let solved = $state(false);
  let powNonce = $state<string | null>(null);

  // The PoW challenge is a hash chain advanced one link per slider step: each
  // step crossed emits chain = sha256(`${chain}:step${i}`). The final link is
  // the PoW input, so the answer is only derivable by actually running the
  // slide progression — it never appears in the page or the island props.
  // Links are enqueued on a promise chain because pointermove events outrun
  // the async digest calls and the links must apply strictly in order.
  // The token is minted once at SSR and never changes for the island's lifetime.
  // svelte-ignore state_referenced_locally
  let chain = token;
  let claimedSteps = 0;
  let stepQueue: Promise<void> = Promise.resolve();
  let destroyed = false;

  $effect(() => () => {
    destroyed = true;
  });

  const enc = new TextEncoder();
  const sha256 = async (input: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(input)));

  function emitSteps() {
    if (maxOffset <= 0) {
      return;
    }
    const target = solved ? CAPTCHA_STEPS : Math.min(Math.floor((offset / maxOffset) * CAPTCHA_STEPS), CAPTCHA_STEPS);
    while (claimedSteps < target) {
      const step = ++claimedSteps;
      stepQueue = stepQueue.then(async () => {
        chain = toHex(await sha256(chainInput(chain, step)));
        if (step === CAPTCHA_STEPS) {
          await solvePow(chain);
        }
      });
    }
  }

  async function solvePow(challenge: string) {
    for (let n = 0; !destroyed; n++) {
      if (leadingZeroBits(await sha256(powInput(challenge, String(n)))) >= bits) {
        powNonce = String(n);
        return;
      }
      if (n % 256 === 255) {
        // Each digest await yields a microtask; a macrotask gap guarantees paint.
        await new Promise((r) => setTimeout(r));
      }
    }
  }

  $effect(() => {
    verified = solved && powNonce !== null;
  });

  const HANDLE = 44;
  let maxOffset = $state(0);
  let offset = $state(0);
  let dragging = false;
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
    if (solved) {
      return;
    }
    dragging = true;
    pointerStart = e.clientX;
    offsetStart = offset;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || solved) {
      return;
    }
    offset = Math.min(Math.max(offsetStart + e.clientX - pointerStart, 0), maxOffset);
    settle();
    emitSteps();
  }

  function onPointerUp() {
    dragging = false;
    if (!solved) {
      offset = 0;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (solved) {
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

<div class="captcha" class:solved class:verified>
  <div class="track" {@attach measureTrack}>
    <div class="fill" style="width: {offset + HANDLE}px"></div>
    <div
      class="handle"
      style="transform: translateX({offset}px)"
      role="slider"
      tabindex={solved ? -1 : 0}
      aria-label="Slide the mochi all the way to the right to prove you're human"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={solved ? 100 : Math.round((offset / Math.max(maxOffset, 1)) * 100)}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onkeydown={onKeyDown}
    >
      🍡
    </div>
    <span class="captcha-hint" aria-live="polite">
      {#if verified}
        Verified — thanks!
      {:else if solved}
        Verifying…
      {:else}
        Slide the mochi to the right
      {/if}
    </span>
  </div>
</div>
<input type="hidden" name="captcha_token" value={verified ? token : ''} />
<input type="hidden" name="captcha_pow" value={verified ? powNonce : ''} />

<style>
  /* Defaults live in each var()'s fallback, not in a declaration on .captcha:
     a value set here would sit on the element itself and beat anything the host
     inherits down from an ancestor, so the theming vars could never be
     overridden. */
  .captcha .track {
    position: relative;
    height: 44px;
    border: 1px solid var(--mochi-captcha-border, #e8e4d8);
    border-radius: 999px;
    background: var(--mochi-captcha-track-bg, #faf8f1);
    overflow: hidden;
  }

  .captcha .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--mochi-captcha-accent-soft, #e0ebe1);
    border-radius: 999px;
  }

  .captcha .handle {
    position: absolute;
    inset: 0 auto 0 0;
    width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.35rem;
    border-radius: 999px;
    background: var(--mochi-captcha-handle-bg, #fffdf8);
    border: 1px solid var(--mochi-captcha-accent, #4a7c59);
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
</style>
