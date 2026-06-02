<script lang="ts">
  import { onMount } from 'svelte';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import toast from 'svelte-french-toast';

  const QUICK_START_CMD = 'bun create mochi@latest';

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    return () => {
      if (copyTimer) {
        clearTimeout(copyTimer);
      }
    };
  });

  function copyCommand() {
    if (!navigator.clipboard) {
      toast.error('Clipboard unavailable in this browser');
      return;
    }
    navigator.clipboard
      .writeText(QUICK_START_CMD)
      .then(() => {
        copied = true;
        toast.success('Copied to clipboard');
        if (copyTimer) {
          clearTimeout(copyTimer);
        }
        copyTimer = setTimeout(() => {
          copied = false;
        }, 1600);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'unknown';
        toast.error(`Copy failed: ${message}`);
      });
  }
</script>

<section class="quickstart" aria-labelledby="quickstart-title">
  <header class="quickstart-head">
    <h2 id="quickstart-title">Quick start</h2>
  </header>
  <div class="terminal" role="figure" aria-label="Terminal command">
    <div class="terminal-bar" aria-hidden="true">
      <span class="terminal-dot terminal-dot-red"></span>
      <span class="terminal-dot terminal-dot-amber"></span>
      <span class="terminal-dot terminal-dot-green"></span>
      <span class="terminal-title">~ terminal</span>
    </div>
    <div class="terminal-body">
      <button class="terminal-line" type="button" onclick={copyCommand} aria-label="Copy command" title="Click to copy">
        <span class="terminal-prompt" aria-hidden="true">$</span>
        <span class="terminal-cmd">{QUICK_START_CMD}</span>
        <span class="terminal-caret" aria-hidden="true"></span>
      </button>
      <button class="terminal-copy" type="button" onclick={copyCommand} aria-label={copied ? 'Copied to clipboard' : 'Copy command'} title={copied ? 'Copied' : 'Copy command'}>
        {#if copied}
          <Check size={13} strokeWidth={2.2} />
          <span class="terminal-copy-label">Copied</span>
        {:else}
          <Copy size={13} strokeWidth={1.8} />
          <span class="terminal-copy-label">Copy</span>
        {/if}
      </button>
    </div>
  </div>
  <p class="quickstart-note">
    Requires <a href="https://bun.sh" target="_blank" rel="noopener noreferrer">Bun</a> <code>&gt;= 1.3.14</code>.
    <a href="/docs/why-bun/" class="why-bun-link" style="border-bottom-color: currentColor;">Why Bun?</a>
  </p>
</section>

<style>
  .quickstart {
    margin-bottom: 1.75rem;
  }

  .quickstart-head {
    margin-bottom: 0.85rem;
  }

  .quickstart-head h2 {
    font-family: var(--font-serif);
    font-size: 1.35rem;
    font-weight: 500;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  .quickstart-note {
    margin-top: 0.6rem;
    padding-left: 0.15rem;
    font-size: 0.78rem;
    line-height: 1.4;
    color: var(--text-subtle);
  }

  .quickstart-note code {
    font-family: var(--font-mono);
    font-size: 0.95em;
    padding: 0.05rem 0.3rem;
    background: var(--surface-muted, var(--surface));
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
  }

  .quickstart-note a {
    color: var(--text-muted);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition:
      color 0.12s ease,
      border-color 0.12s ease;
  }

  .quickstart-note a:hover {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .terminal {
    background: #1f2a24;
    border: 1px solid #0f1612;
    border-radius: var(--radius-lg);
    box-shadow:
      0 14px 36px rgba(15, 22, 18, 0.18),
      0 2px 6px rgba(15, 22, 18, 0.08),
      0 0 0 1px rgba(255, 255, 255, 0.03) inset;
    overflow: hidden;
  }

  .terminal-bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.85rem;
    background: rgba(0, 0, 0, 0.22);
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .terminal-dot {
    width: 0.72rem;
    height: 0.72rem;
    border-radius: 999px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25) inset;
  }

  .terminal-dot-red {
    background: #ff5f57;
  }

  .terminal-dot-amber {
    background: #febc2e;
  }

  .terminal-dot-green {
    background: #28c840;
  }

  .terminal-title {
    margin-left: 0.6rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: rgba(232, 230, 221, 0.45);
    letter-spacing: 0.03em;
  }

  .terminal-body {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.05rem 1.15rem 1.05rem 1.25rem;
    font-family: var(--font-mono);
    font-size: 0.98rem;
    line-height: 1.4;
    color: #e8e6dd;
  }

  .terminal-line {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    overflow-x: auto;
    white-space: nowrap;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .terminal-line:focus-visible {
    outline: 2px solid #8ab79a;
    outline-offset: 2px;
    border-radius: 2px;
  }

  .terminal-prompt {
    color: #8ab79a;
    font-weight: 600;
    user-select: none;
  }

  .terminal-cmd {
    color: #e8e6dd;
  }

  .terminal-caret {
    display: inline-block;
    width: 0.5rem;
    height: 1.05em;
    background: #8ab79a;
    border-radius: 1px;
    animation: terminal-caret-blink 1.1s steps(2, end) infinite;
    transform: translateY(0.12em);
    opacity: 0.85;
  }

  @keyframes terminal-caret-blink {
    0%,
    50% {
      opacity: 0.85;
    }
    51%,
    100% {
      opacity: 0;
    }
  }

  .terminal-copy {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: rgba(232, 230, 221, 0.08);
    border: 1px solid rgba(232, 230, 221, 0.14);
    color: #d4d2c7;
    font-family: var(--font-sans);
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.4rem 0.7rem;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease,
      transform 0.12s ease;
    letter-spacing: 0.02em;
  }

  .terminal-copy:hover {
    background: rgba(232, 230, 221, 0.14);
    border-color: rgba(232, 230, 221, 0.24);
    color: #ffffff;
  }

  .terminal-copy:active {
    transform: translateY(1px);
  }

  .terminal-copy:focus-visible {
    outline: 2px solid #8ab79a;
    outline-offset: 2px;
  }

  .terminal-copy-label {
    line-height: 1;
  }

  @media (max-width: 540px) {
    .terminal-body {
      padding: 0.9rem 0.95rem;
      font-size: 0.85rem;
    }
    .terminal-copy-label {
      display: none;
    }
    .terminal-copy {
      padding: 0.4rem 0.5rem;
    }
  }
</style>
