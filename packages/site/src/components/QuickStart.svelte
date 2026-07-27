<script lang="ts">
  import { onMount } from 'svelte';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import toast from 'svelte-french-toast';

  // Inlined from @mdi/js — importing the named exports pulls in its ~2.7 MB barrel
  // (`mdi.js`, no per-icon sub-paths) and re-parses it on every rebuild. These three
  // are static path strings, so they cost nothing inlined.
  const mdiApple =
    'M18.71,19.5C17.88,20.74 17,21.95 15.66,21.97C14.32,22 13.89,21.18 12.37,21.18C10.84,21.18 10.37,21.95 9.1,22C7.79,22.05 6.8,20.68 5.96,19.47C4.25,17 2.94,12.45 4.7,9.39C5.57,7.87 7.13,6.91 8.82,6.88C10.1,6.86 11.32,7.75 12.11,7.75C12.89,7.75 14.37,6.68 15.92,6.84C16.57,6.87 18.39,7.1 19.56,8.82C19.47,8.88 17.39,10.1 17.41,12.63C17.44,15.65 20.06,16.66 20.09,16.67C20.06,16.74 19.67,18.11 18.71,19.5M13,3.5C13.73,2.67 14.94,2.04 15.94,2C16.07,3.17 15.6,4.35 14.9,5.19C14.21,6.04 13.07,6.7 11.95,6.61C11.8,5.46 12.36,4.26 13,3.5Z';
  const mdiMicrosoftWindows = 'M3,12V6.75L9,5.43V11.91L3,12M20,3V11.75L10,11.9V5.21L20,3M3,13L9,13.09V19.9L3,18.75V13M20,13.25V22L10,20.09V13.1L20,13.25Z';
  const mdiLinux =
    'M14.62,8.35C14.2,8.63 12.87,9.39 12.67,9.54C12.28,9.85 11.92,9.83 11.53,9.53C11.33,9.37 10,8.61 9.58,8.34C9.1,8.03 9.13,7.64 9.66,7.42C11.3,6.73 12.94,6.78 14.57,7.45C15.06,7.66 15.08,8.05 14.62,8.35M21.84,15.63C20.91,13.54 19.64,11.64 18,9.97C17.47,9.42 17.14,8.8 16.94,8.09C16.84,7.76 16.77,7.42 16.7,7.08C16.5,6.2 16.41,5.3 16,4.47C15.27,2.89 14,2.07 12.16,2C10.35,2.05 9,2.81 8.21,4.4C8,4.83 7.85,5.28 7.75,5.74C7.58,6.5 7.43,7.29 7.25,8.06C7.1,8.71 6.8,9.27 6.29,9.77C4.68,11.34 3.39,13.14 2.41,15.12C2.27,15.41 2.13,15.7 2.04,16C1.85,16.66 2.33,17.12 3.03,16.96C3.47,16.87 3.91,16.78 4.33,16.65C4.74,16.5 4.9,16.6 5,17C5.65,19.15 7.07,20.66 9.24,21.5C13.36,23.06 18.17,20.84 19.21,16.92C19.28,16.65 19.38,16.55 19.68,16.65C20.14,16.79 20.61,16.89 21.08,17C21.57,17.09 21.93,16.84 22,16.36C22.03,16.1 21.94,15.87 21.84,15.63';

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
    <span class="quickstart-note-text">
      Requires <a href="https://bun.sh" target="_blank" rel="noopener noreferrer">Bun</a> <code>&gt;= 1.3.14</code>.
      <a href="/docs/why-bun/" class="why-bun-link" style="border-bottom-color: currentColor;">Why Bun?</a>
    </span>
    <span class="os-icons">
      <svg class="os-icon" viewBox="0 0 24 24" role="img" aria-label="Supports macOS"><title>Supports macOS</title><path d={mdiApple} /></svg>
      <svg class="os-icon" viewBox="0 0 24 24" role="img" aria-label="Supports Windows"><title>Supports Windows</title><path d={mdiMicrosoftWindows} /></svg>
      <svg class="os-icon" viewBox="0 0 24 24" role="img" aria-label="Supports Linux"><title>Supports Linux</title><path d={mdiLinux} /></svg>
    </span>
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
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
  }

  .os-icons {
    margin-left: auto;
    margin-right: 0.85rem;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--text-subtle);
  }

  .os-icon {
    height: 17px;
    width: auto;
    fill: currentColor;
    opacity: 0.65;
    transition:
      opacity 0.12s ease,
      color 0.12s ease;
  }

  .os-icon:hover {
    opacity: 1;
    color: var(--accent);
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

  @media (max-width: 400px) {
    .quickstart-note {
      flex-direction: column;
      align-items: flex-start;
    }
    .os-icons {
      margin-left: 0;
    }
  }
</style>
