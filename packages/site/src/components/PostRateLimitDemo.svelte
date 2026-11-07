<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Zap from '@lucide/svelte/icons/zap';
  import ZapOff from '@lucide/svelte/icons/zap-off';

  // Purely illustrative — a local counter, no network; it clicks itself in a loop that
  // fills the meter, trips a mock 429, cools down, then repeats.
  const LIMIT = 5;
  const COOLDOWN = 5;

  let root: HTMLDivElement | undefined = $state();
  let used = $state(0);
  let limited = $state(false);
  let pressing = $state(false);
  let resetIn = $state(0);
  let cooldownTimer: ReturnType<typeof setInterval> | undefined;
  let loopTimer: ReturnType<typeof setInterval> | undefined;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let observer: IntersectionObserver | undefined;

  onMount(() => {
    // Hold still until the demo scrolls into view, then drive the button on a steady beat —
    // send() no-ops while limited, so the loop pauses for the cooldown and resumes on its own.
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer?.disconnect();
        autoPress();
        loopTimer = setInterval(autoPress, 850);
      }
    });
    if (root) {
      observer.observe(root);
    }
  });

  onDestroy(() => {
    observer?.disconnect();
    clearInterval(cooldownTimer);
    clearInterval(loopTimer);
    clearTimeout(pressTimer);
  });

  function autoPress() {
    if (limited) {
      return;
    }
    pressing = true;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => (pressing = false), 140);
    send();
  }

  function send() {
    if (limited) {
      return;
    }
    if (used < LIMIT) {
      used += 1;
      return;
    }
    // Sixth click: over the limit.
    limited = true;
    resetIn = COOLDOWN;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      resetIn -= 1;
      if (resetIn <= 0) {
        clearInterval(cooldownTimer);
        limited = false;
        used = 0;
      }
    }, 1000);
  }
</script>

<div class="rl" class:limited bind:this={root}>
  <div class="pips" role="img" aria-label={limited ? 'Rate limited' : `${used} of ${LIMIT} requests used`}>
    {#each Array(LIMIT) as _, i (i)}
      <span class="pip" class:filled={i < used} style={`--i: ${i}`}></span>
    {/each}
  </div>

  <button type="button" class:pressing onclick={autoPress} disabled={limited}>
    {#if limited}
      <ZapOff size={16} strokeWidth={2} aria-hidden="true" />
      429 — cooling down {resetIn}s
    {:else}
      <Zap size={16} strokeWidth={2} aria-hidden="true" />
      Send request
    {/if}
  </button>

  <p class="status" aria-live="polite">
    {#if limited}
      Too many requests — the window resets in {resetIn}s.
    {:else}
      {LIMIT - used} of {LIMIT} requests left this window.
    {/if}
  </p>
</div>

<style>
  .rl {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem;
    margin: 1.25rem 0;
  }

  .pips {
    display: flex;
    gap: 0.4rem;
  }

  .pip {
    width: 1.6rem;
    height: 0.55rem;
    border-radius: 999px;
    background: var(--border-strong);
    transition:
      background 0.2s ease,
      transform 0.2s ease;
  }

  .pip.filled {
    background: var(--accent);
    transform: scaleY(1.15);
  }

  .limited .pip {
    background: #d9534f;
    animation: pip-flash 0.4s ease;
    /* Stagger the flash left-to-right so it reads as the limit tripping. */
    animation-delay: calc(var(--i) * 60ms);
  }

  @keyframes pip-flash {
    0% {
      transform: scaleY(1);
    }
    50% {
      transform: scaleY(1.6);
    }
    100% {
      transform: scaleY(1);
    }
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    border-radius: var(--radius-md);
    padding: 0.45rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.15s ease,
      transform 0.08s ease;
  }

  button:active,
  button.pressing {
    transform: scale(0.96);
  }

  button:disabled {
    cursor: default;
  }

  .limited button {
    background: #d9534f;
    color: #fff;
    animation: shake 0.4s ease;
  }

  @keyframes shake {
    0%,
    100% {
      transform: translateX(0);
    }
    20% {
      transform: translateX(-5px);
    }
    40% {
      transform: translateX(5px);
    }
    60% {
      transform: translateX(-3px);
    }
    80% {
      transform: translateX(3px);
    }
  }

  .status {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .pip,
    .limited .pip,
    .limited button,
    button.pressing {
      animation: none;
      transition: none;
    }
  }
</style>
