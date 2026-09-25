<script lang="ts">
  const phrases = [
    'a Svelte meta-framework',
    'zero JS by default',
    'full-stack Svelte on Bun',
    'islands architecture',
    'real-time ready',
    'agent-ready',
    'fast by default',
    'open source',
    'batteries included',
  ].map((phrase) =>
    // A word joiner on each side of the hyphen stops wrapping from splitting "meta-framework".
    phrase.replaceAll('-', '\u2060-\u2060'),
  );

  let index = $state(0);
  let previous = $state(-1);
  let widths = $state<number[]>([]);
  let rotator: HTMLElement;
  const slots: HTMLElement[] = $state([]);

  $effect(() => {
    const measure = () => (widths = slots.map((slot) => slot.offsetWidth));
    measure();
    void document.fonts.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(rotator);

    const timer = matchMedia('(prefers-reduced-motion: reduce)').matches
      ? undefined
      : setInterval(() => {
          previous = index;
          index = (index + 1) % phrases.length;
        }, 3000);

    return () => {
      clearInterval(timer);
      observer.disconnect();
    };
  });
</script>

<h1 class="headline">
  <span class="headline-lead">Mochi is</span>
  <span class="sr-only">{phrases[0]}</span>
  <span class="rotator" aria-hidden="true" bind:this={rotator}>
    <!-- Until hydration measures the phrases, the first one's text sizes the brush. -->
    <span class="brush" style:width={widths[index] ? `calc(${widths[index]}px + 0.24em)` : undefined}
      >{#if !widths.length}{phrases[0]}{/if}</span
    >
    {#each phrases as phrase, i (phrase)}
      <span class="phrase" class:active={i === index} class:leaving={i === previous} bind:this={slots[i]}>{phrase}</span>
    {/each}
  </span>
</h1>

<style>
  .headline {
    --brush: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 60' preserveAspectRatio='none'%3E%3Cpath fill='%23b9dbbf' d='M8 16 L20 11 C80 7 150 10 220 7 C290 4 350 8 386 8 L395 15 L389 21 L397 29 L390 36 L396 45 C350 51 290 48 225 52 C160 56 90 51 36 54 L14 50 L21 43 L5 37 L15 29 L3 22 Z'/%3E%3Cpath fill='%23b9dbbf' fill-opacity='.55' d='M40 3 C140 0 280 -1 372 3 L376 7 C280 6 150 8 40 8 Z M60 55 C160 58 270 57 350 55 L346 59 C260 60 150 60 64 59 Z'/%3E%3C/svg%3E");
    font-family: var(--font-serif);
    font-size: clamp(2.4rem, 5vw, 3.6rem);
    font-weight: 400;
    line-height: 1.08;
    letter-spacing: -0.025em;
    color: var(--text);
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
    margin-bottom: 1.25rem;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .headline {
      --brush: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 60' preserveAspectRatio='none'%3E%3Cpath fill='%2336613f' d='M8 16 L20 11 C80 7 150 10 220 7 C290 4 350 8 386 8 L395 15 L389 21 L397 29 L390 36 L396 45 C350 51 290 48 225 52 C160 56 90 51 36 54 L14 50 L21 43 L5 37 L15 29 L3 22 Z'/%3E%3Cpath fill='%2336613f' fill-opacity='.55' d='M40 3 C140 0 280 -1 372 3 L376 7 C280 6 150 8 40 8 Z M60 55 C160 58 270 57 350 55 L346 59 C260 60 150 60 64 59 Z'/%3E%3C/svg%3E");
    }
  }

  :global(:root[data-theme='dark']) .headline {
    --brush: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 60' preserveAspectRatio='none'%3E%3Cpath fill='%2336613f' d='M8 16 L20 11 C80 7 150 10 220 7 C290 4 350 8 386 8 L395 15 L389 21 L397 29 L390 36 L396 45 C350 51 290 48 225 52 C160 56 90 51 36 54 L14 50 L21 43 L5 37 L15 29 L3 22 Z'/%3E%3Cpath fill='%2336613f' fill-opacity='.55' d='M40 3 C140 0 280 -1 372 3 L376 7 C280 6 150 8 40 8 Z M60 55 C160 58 270 57 350 55 L346 59 C260 60 150 60 64 59 Z'/%3E%3C/svg%3E");
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .headline-lead {
    display: block;
  }

  .rotator {
    display: grid;
  }

  .brush,
  .phrase {
    grid-area: 1 / 1;
    justify-self: start;
  }

  .brush {
    padding: 0 0.12em;
    margin-left: -0.12em;
    color: transparent;
    white-space: nowrap;
    overflow: hidden;
    user-select: none;
    background: var(--brush) no-repeat 0 80% / 100% 62%;
    animation: brush-sweep 0.8s 0.3s cubic-bezier(0.6, 0, 0.3, 1) backwards;
    transition: width 0.6s cubic-bezier(0.6, 0, 0.3, 1);
  }

  .phrase {
    opacity: 0;
    transform: translateY(0.25em);
    transition:
      opacity 0.4s ease,
      transform 0.4s ease;
  }

  .phrase.leaving {
    transform: translateY(-0.25em);
  }

  .phrase.active {
    opacity: 1;
    transform: none;
    transition-delay: 0.15s;
  }

  @keyframes brush-sweep {
    from {
      background-size: 0% 62%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .brush,
    .phrase {
      animation: none;
      transition: none;
    }
  }

  @media (max-width: 1024px) {
    .headline {
      max-width: 22ch;
    }
  }

  @media (max-width: 720px) {
    .headline {
      font-size: min(2.4rem, 9.4vw);
    }
  }
</style>
