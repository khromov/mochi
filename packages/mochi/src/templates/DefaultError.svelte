<script lang="ts">
  import BackLink from './BackLink.svelte';
  import type { MochiErrorProps } from '../types';

  let { error }: MochiErrorProps = $props();
</script>

<svelte:head>
  <title>{error.status} {error.message}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<div class="wrap">
  <header class="topbar">
    <span class="brand">
      <span class="logo" aria-hidden="true">🍡</span><span>mochi</span>
    </span>
  </header>

  <main class="stage">
    <section class="panel">
      <p class="status">{error.status}</p>
      <p class="message">{error.message}</p>
      <div class="actions">
        <BackLink mochi:hydrate />
      </div>
      {#if error.stack}
        <div class="divider"></div>
        <div class="stack-label">Stack trace</div>
        <pre class="stack">{error.stack}</pre>
      {/if}
    </section>
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
    --mochi-error-bg: #f1ecdf;
    --mochi-error-bg-card: #fbf8f1;
    --mochi-error-ink: #2a2825;
    --mochi-error-ink-soft: #6b665e;
    --mochi-error-ink-faint: #a39e94;
    --mochi-error-rule: #e6e0d2;
    --mochi-error-code-bg: #2a2825;
    --mochi-error-code-ink: #f1ecdf;
    --mochi-error-gradient-tint: rgba(56, 92, 71, 0.1);
    --mochi-error-shadow: 0 1px 0 rgba(42, 40, 37, 0.04), 0 30px 60px -28px rgba(42, 40, 37, 0.18), 0 12px 24px -16px rgba(42, 40, 37, 0.1);

    --mochi-error-font-serif: Georgia, 'Iowan Old Style', 'Palatino Linotype', Cambria, serif;
    --mochi-error-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --mochi-error-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

    min-height: 100vh;
    width: 100%;
    background: radial-gradient(1200px 600px at 50% -10%, var(--mochi-error-gradient-tint), transparent 60%), var(--mochi-error-bg);
    color: var(--mochi-error-ink);
    font-family: var(--mochi-error-font-sans);
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    isolation: isolate;
  }

  .topbar {
    padding: 22px 28px;
  }

  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--mochi-error-font-serif);
    font-weight: 600;
    font-size: 20px;
    color: var(--mochi-error-ink);
    opacity: 0.75;
  }

  .logo {
    line-height: 1;
    transform: translateY(2px);
  }

  .stage {
    min-height: calc(100vh - 78px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 24px 60px;
  }

  .panel {
    width: 100%;
    max-width: 620px;
    background: var(--mochi-error-bg-card);
    border: 1px solid var(--mochi-error-rule);
    border-radius: 14px;
    padding: 44px 44px 38px;
    box-shadow: var(--mochi-error-shadow);
  }

  .status {
    font-family: var(--mochi-error-font-serif);
    font-weight: 500;
    font-size: 88px;
    line-height: 1;
    letter-spacing: -0.03em;
    margin: 0;
    color: var(--mochi-error-ink);
  }

  .message {
    font-family: var(--mochi-error-font-serif);
    font-style: italic;
    font-size: 19px;
    line-height: 1.5;
    margin: 14px 0 26px;
    color: var(--mochi-error-ink-soft);
    word-break: break-word;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .divider {
    height: 1px;
    background: var(--mochi-error-rule);
    margin: 30px -44px 22px;
  }

  .stack-label {
    font-family: var(--mochi-error-font-serif);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--mochi-error-ink-faint);
    margin-bottom: 10px;
  }

  .stack {
    margin: 0;
    padding: 16px 18px;
    background: var(--mochi-error-code-bg);
    color: var(--mochi-error-code-ink);
    border: 0;
    border-radius: 8px;
    font-family: var(--mochi-error-font-mono);
    font-size: 12.5px;
    line-height: 1.6;
    max-width: 100%;
    overflow: auto;
    white-space: pre;
    -webkit-overflow-scrolling: touch;
  }

  @media (max-width: 640px) {
    .topbar {
      padding: 18px 20px;
    }
    .stage {
      min-height: calc(100vh - 70px);
      padding: 16px 16px 48px;
    }
    .panel {
      padding: 30px 22px 26px;
      border-radius: 12px;
    }
    .status {
      font-size: 64px;
      letter-spacing: -0.025em;
    }
    .message {
      font-size: 17px;
      margin: 10px 0 22px;
    }
    .brand {
      font-size: 18px;
    }
    .divider {
      margin: 26px -22px 20px;
    }
    .stack {
      font-size: 11.5px;
      padding: 14px;
      line-height: 1.55;
    }
  }
  @media (max-width: 380px) {
    .status {
      font-size: 52px;
    }
    .message {
      font-size: 16px;
    }
    .panel {
      padding: 24px 18px 22px;
    }
    .divider {
      margin: 22px -18px 16px;
    }
  }

  @media (prefers-color-scheme: dark) {
    .wrap {
      --mochi-error-bg: #1a1815;
      --mochi-error-bg-card: #23201c;
      --mochi-error-ink: #f1ecdf;
      --mochi-error-ink-soft: #a39e94;
      --mochi-error-ink-faint: #6b665e;
      --mochi-error-rule: #2d2a25;
      --mochi-error-code-bg: #0f0e0c;
      --mochi-error-code-ink: #e6e0d2;
      --mochi-error-gradient-tint: rgba(154, 184, 163, 0.06);
      --mochi-error-shadow: 0 1px 0 rgba(0, 0, 0, 0.3), 0 30px 60px -28px rgba(0, 0, 0, 0.6), 0 12px 24px -16px rgba(0, 0, 0, 0.4);
    }
  }
</style>
