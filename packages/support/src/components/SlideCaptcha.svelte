<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import { powInput, leadingZeroBits } from '../lib/pow';

  let { token = '', bits = 16, verified = $bindable(false) }: { token?: string; bits?: number; verified?: boolean } = $props();

  let solved = $state(false);
  let powNonce = $state<string | null>(null);

  // Solve the proof-of-work eagerly on mount ($effect never runs during SSR)
  // so it's usually done before a human finishes sliding. The server enforces
  // a minimum token age, so the head start gives bots nothing.
  $effect(() => {
    let cancelled = false;
    (async () => {
      const enc = new TextEncoder();
      for (let n = 0; !cancelled; n++) {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(powInput(token, String(n)))));
        if (leadingZeroBits(digest) >= bits) {
          powNonce = String(n);
          return;
        }
        if (n % 256 === 255) {
          // Each digest await yields a microtask; a macrotask gap guarantees paint.
          await new Promise((r) => setTimeout(r));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });

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
  .captcha .track {
    position: relative;
    height: 44px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-muted);
    overflow: hidden;
  }

  .captcha .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent-soft);
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
    background: var(--surface);
    border: 1px solid var(--accent);
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
    color: var(--text-subtle);
    pointer-events: none;
  }

  .captcha.verified .captcha-hint {
    color: var(--accent-soft-text);
    font-weight: 600;
  }
</style>
