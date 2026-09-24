<script lang="ts">
  let count = $state(0);

  function squish(event: MouseEvent & { currentTarget: HTMLButtonElement }) {
    count++;
    const ball = event.currentTarget;
    const shadow = ball.nextElementSibling;
    if (!shadow || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const timing = { duration: 640, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' };
    ball.animate(
      [
        { transform: 'scale(1, 1)', borderRadius: '50% 50% 46% 46% / 54% 54% 46% 46%' },
        { transform: 'scale(1.2, 0.76)', borderRadius: '46% 46% 40% 40% / 62% 62% 34% 34%' },
        { transform: 'scale(0.9, 1.12)', borderRadius: '50% 50% 46% 46% / 44% 44% 56% 56%' },
        { transform: 'scale(1.05, 0.96)', borderRadius: '50% 50% 46% 46% / 54% 54% 46% 46%' },
        { transform: 'scale(1, 1)', borderRadius: '50% 50% 46% 46% / 54% 54% 46% 46%' },
      ],
      timing,
    );
    shadow.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(1.3)' }, { transform: 'scaleX(0.9)' }, { transform: 'scaleX(1)' }], timing);
  }
</script>

<div class="squish-counter">
  <div class="stage">
    <button class="ball" type="button" onclick={squish} aria-label="Squish the mochi">
      <span class="face" aria-hidden="true">
        <span class="eye"></span>
        <span class="mouth"></span>
        <span class="eye"></span>
      </span>
      <span class="blush blush-left" aria-hidden="true"></span>
      <span class="blush blush-right" aria-hidden="true"></span>
    </button>
    <span class="shadow" aria-hidden="true"></span>
  </div>
  <p class="count" aria-live="polite">
    Squished <strong>{count}</strong>
    {count === 1 ? 'time' : 'times'}
  </p>
</div>

<style>
  .squish-counter {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
  }

  .stage {
    position: relative;
    display: grid;
    place-items: center;
    padding-bottom: 14px;
  }

  .ball {
    position: relative;
    z-index: 1;
    width: 168px;
    height: 150px;
    border: 0;
    border-radius: 50% 50% 46% 46% / 54% 54% 46% 46%;
    background: radial-gradient(circle at 34% 28%, #ffffff 0%, rgba(255, 255, 255, 0) 38%), radial-gradient(circle at 50% 42%, #fffdfb 0%, #fbf1ec 52%, #ecd6cf 100%);
    box-shadow:
      inset 0 -14px 22px rgba(120, 70, 70, 0.14),
      inset 0 6px 14px rgba(255, 255, 255, 0.9);
    transform-origin: 50% 100%;
    cursor: pointer;
    transition: filter 0.15s ease;
  }

  .ball:hover {
    filter: brightness(1.03) saturate(1.1);
  }

  .ball:focus-visible {
    outline: 3px solid var(--f3-ink, #3b1f24);
    outline-offset: 6px;
  }

  .face {
    position: absolute;
    left: 50%;
    top: 52%;
    display: flex;
    align-items: center;
    gap: 14px;
    transform: translate(-50%, -50%);
  }

  .eye {
    width: 9px;
    height: 11px;
    border-radius: 50%;
    background: #3b1f24;
  }

  .mouth {
    width: 14px;
    height: 8px;
    margin-top: 8px;
    border: 2.5px solid #3b1f24;
    border-top: 0;
    border-radius: 0 0 14px 14px;
  }

  .blush {
    position: absolute;
    top: 60%;
    width: 22px;
    height: 12px;
    border-radius: 50%;
    background: #f2a3b5;
    opacity: 0.75;
  }

  .blush-left {
    left: 24%;
  }

  .blush-right {
    right: 24%;
  }

  .shadow {
    position: absolute;
    bottom: 2px;
    width: 130px;
    height: 20px;
    border-radius: 50%;
    background: rgba(59, 31, 36, 0.16);
    filter: blur(3px);
  }

  .count {
    font-size: 0.95rem;
    color: var(--f3-ink-soft, #6b4a4f);
  }

  .count strong {
    font-family: var(--font-serif);
    font-variation-settings:
      'opsz' 144,
      'SOFT' 100,
      'WONK' 1;
    font-weight: 750;
    font-size: 1.3rem;
    color: var(--f3-ink, #3b1f24);
  }
</style>
