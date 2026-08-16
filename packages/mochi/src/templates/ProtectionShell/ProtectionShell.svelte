<script lang="ts">
  import MochiCaptchaAuto from '../../captcha/MochiCaptchaAuto.svelte';
  import type { MochiProtectionPageProps } from '../../protection/types';

  let { token, bits, solveBudgetMs, verifyUrl }: MochiProtectionPageProps = $props();
</script>

<svelte:head>
  <title>Checking your browser…</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap">
  <main class="stage">
    <span class="brand">
      <span class="logo" aria-hidden="true">🍡</span><span>mochi</span>
    </span>
    <p class="message">Please wait, we're validating your browser...</p>
    <div class="widget">
      <MochiCaptchaAuto mochi:hydrate {token} {bits} {solveBudgetMs} {verifyUrl} />
    </div>
  </main>
</div>

<style>
  :global(html, body) {
    margin: 0;
    overflow-x: hidden;
  }
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }
  :global(body) {
    color-scheme: light dark;
  }

  .wrap {
    --mochi-protection-bg: #f1ecdf;
    --mochi-protection-ink: #2a2825;
    --mochi-protection-ink-soft: #6b665e;
    --mochi-protection-gradient-tint: rgba(56, 92, 71, 0.1);

    --mochi-protection-font-serif: Georgia, 'Iowan Old Style', 'Palatino Linotype', Cambria, serif;
    --mochi-protection-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;

    min-height: 100vh;
    width: 100%;
    background: radial-gradient(1200px 600px at 50% -10%, var(--mochi-protection-gradient-tint), transparent 60%), var(--mochi-protection-bg);
    color: var(--mochi-protection-ink);
    font-family: var(--mochi-protection-font-sans);
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }

  .stage {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding: 24px;
    text-align: center;
  }

  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
    font-family: var(--mochi-protection-font-serif);
    font-weight: 600;
    font-size: 28px;
  }

  .logo {
    font-size: 44px;
    line-height: 1;
    transform: translateY(4px);
  }

  .message {
    font-family: var(--mochi-protection-font-serif);
    font-style: italic;
    font-size: 18px;
    margin: 0;
    color: var(--mochi-protection-ink-soft);
  }

  .widget {
    width: min(320px, 100%);
  }

  @media (prefers-color-scheme: dark) {
    .wrap {
      --mochi-protection-bg: #1a1815;
      --mochi-protection-ink: #f1ecdf;
      --mochi-protection-ink-soft: #a39e94;
      --mochi-protection-gradient-tint: rgba(154, 184, 163, 0.06);
    }

    .widget {
      --mochi-captcha-border: #2d2a25;
      --mochi-captcha-track-bg: #23201c;
      --mochi-captcha-accent: #9ab8a3;
      --mochi-captcha-accent-soft: #2f3b33;
      --mochi-captcha-hint-text: #a39e94;
      --mochi-captcha-error-bg: #2b1e1b;
      --mochi-captcha-error-border: #4a322c;
      --mochi-captcha-error-text: #e0a294;
    }
  }
</style>
