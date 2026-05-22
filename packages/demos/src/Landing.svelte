<script lang="ts">
  import '@fontsource-variable/fraunces/full.css';
  import '@fontsource-variable/public-sans';
  import Newspaper from '@lucide/svelte/icons/newspaper';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import type { Component } from 'svelte';

  const QUICK_START_CMD = 'bun create mochi@latest';

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  function copyCommand() {
    if (!navigator.clipboard) {
      return;
    }
    navigator.clipboard.writeText(QUICK_START_CMD).then(() => {
      copied = true;
      if (copyTimer) {
        clearTimeout(copyTimer);
      }
      copyTimer = setTimeout(() => {
        copied = false;
      }, 1600);
    });
  }

  type Demo = {
    href: string;
    title: string;
    hook: string;
    accent: string;
    accentSoft: string;
    icon: Component;
  };

  const demos: Demo[] = [
    {
      href: '/hn/',
      title: 'Hacker News',
      hook: 'A faithful clone of news.ycombinator.com — uses hydrated islands to load comment.',
      accent: '#ff6600',
      accentSoft: '#ffe6d2',
      icon: Newspaper,
    },
    {
      href: '/admin/',
      title: 'Admin Dashboard',
      hook: 'Real-time stock ticker over SSE, hydrated charts, dark mode toggle.',
      accent: '#4a7c59',
      accentSoft: '#dbe8df',
      icon: LayoutDashboard,
    },
    {
      href: '/todo/',
      title: 'Todo',
      hook: 'Minimal interactive list, styled end-to-end with Tailwind.',
      accent: '#5f6bbf',
      accentSoft: '#e0e3f4',
      icon: ListChecks,
    },
  ];
</script>

<svelte:head>
  <title>Mochi Demos</title>
  <meta name="description" content="A small collection of real apps built on the Mochi framework." />
</svelte:head>

<main class="landing">
  <header class="hero">
    <h1>Mochi Demos</h1>
    <p class="lede">A small collection of real apps built on the Mochi framework — server-rendered Svelte with islands of hydration.</p>
  </header>

  <section class="quickstart" aria-labelledby="quickstart-title">
    <header class="quickstart-head">
      <h2 id="quickstart-title">Quick start</h2>
      <p class="quickstart-hint">Scaffold a new Mochi project in seconds. Requires <a href="https://bun.sh" target="_blank" rel="noopener noreferrer">Bun</a>.</p>
    </header>
    <div class="terminal" role="figure" aria-label="Terminal command">
      <div class="terminal-bar" aria-hidden="true">
        <span class="terminal-dot terminal-dot-red"></span>
        <span class="terminal-dot terminal-dot-amber"></span>
        <span class="terminal-dot terminal-dot-green"></span>
        <span class="terminal-title">~ &nbsp;—&nbsp; zsh</span>
      </div>
      <div class="terminal-body">
        <div class="terminal-line">
          <span class="terminal-prompt" aria-hidden="true">$</span>
          <span class="terminal-cmd">{QUICK_START_CMD}</span>
          <span class="terminal-caret" aria-hidden="true"></span>
        </div>
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
  </section>

  <section class="grid" aria-label="Demo applications">
    {#each demos as demo (demo.href)}
      {@const Icon = demo.icon}
      <a class="tile" href={demo.href} style="--tile-accent: {demo.accent}; --tile-accent-soft: {demo.accentSoft};">
        <span class="tile-icon" aria-hidden="true">
          <Icon size={22} strokeWidth={1.6} />
        </span>

        <h2 class="tile-title">{demo.title}</h2>
        <p class="tile-hook">{demo.hook}</p>

        <span class="tile-foot">
          <span class="tile-path">{demo.href}</span>
          <span class="tile-arrow" aria-hidden="true">
            <ArrowRight size={16} strokeWidth={1.8} />
          </span>
        </span>
      </a>
    {/each}
  </section>

  <footer class="foot">
    <a href="https://github.com/khromov/mochi" target="_blank" rel="noopener noreferrer">source on github</a>
    <span class="sep" aria-hidden="true">·</span>
    <a href="https://mochi.fast" target="_blank" rel="noopener noreferrer">framework docs</a>
  </footer>
</main>

<style>
  /* Landing-only palette. We deliberately don't reuse the shell's --admin-*
     tokens because those flip with prefers-color-scheme / data-theme; the
     landing page is pinned light regardless of the user's system theme.
     Defined on :root (scoped via :global) so body can also see them — this
     stylesheet is only loaded on the / route. */
  :global(:root) {
    --l-bg: #f5f3ec;
    --l-surface: #fffdf8;
    --l-border: #e8e4d8;
    --l-text: #1f2a24;
    --l-text-muted: #4a5751;
    --l-text-subtle: #8a9189;
    --l-accent: #4a7c59;
    --l-shadow-sm: 0 1px 3px rgba(47, 61, 51, 0.05);
    --l-shadow-md: 0 4px 16px rgba(47, 61, 51, 0.06), 0 1px 3px rgba(47, 61, 51, 0.04);
    --l-radius-md: 8px;
    --l-radius-lg: 16px;
    --l-font-sans: 'Public Sans', system-ui, -apple-system, sans-serif;
    --l-font-serif: 'Fraunces Variable', Georgia, 'Times New Roman', serif;
    --l-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    min-height: 100vh;
    background: var(--l-bg);
    color: var(--l-text);
    font-family: var(--l-font-sans);
    line-height: 1.55;
    color-scheme: light;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .landing {
    max-width: 64rem;
    margin: 0 auto;
    padding: clamp(3rem, 8vw, 6rem) clamp(1.25rem, 4vw, 2.5rem) 4rem;
  }

  .hero {
    margin-bottom: clamp(1.75rem, 4vw, 2.5rem);
  }

  .quickstart {
    margin-bottom: clamp(2.25rem, 5vw, 3.25rem);
  }

  .quickstart-head {
    margin-bottom: 0.85rem;
  }

  .quickstart-head h2 {
    font-family: var(--l-font-serif);
    font-weight: 500;
    font-variation-settings: 'opsz' 36;
    font-size: 1.4rem;
    line-height: 1.1;
    letter-spacing: -0.015em;
    color: var(--l-text);
  }

  .quickstart-hint {
    margin-top: 0.35rem;
    font-size: 0.92rem;
    color: var(--l-text-muted);
  }

  .quickstart-hint a {
    color: var(--l-accent);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition:
      color 120ms ease,
      border-color 120ms ease;
  }

  .quickstart-hint a:hover {
    border-bottom-color: var(--l-accent);
  }

  .terminal {
    background: #1f2a24;
    border: 1px solid #0f1612;
    border-radius: var(--l-radius-lg);
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
    font-family: var(--l-font-mono);
    font-size: 0.72rem;
    color: rgba(232, 230, 221, 0.45);
    letter-spacing: 0.03em;
  }

  .terminal-body {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.05rem 1.15rem 1.05rem 1.25rem;
    font-family: var(--l-font-mono);
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
  }

  .terminal-prompt {
    color: #8ab79a;
    font-weight: 600;
    user-select: none;
  }

  .terminal-cmd {
    color: #e8e6dd;
    user-select: text;
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
    font-family: var(--l-font-sans);
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.4rem 0.7rem;
    border-radius: var(--l-radius-md);
    cursor: pointer;
    transition:
      background 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      transform 120ms ease;
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

  .hero h1 {
    font-family: var(--l-font-serif);
    font-weight: 400;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
    font-size: clamp(3rem, 9vw, 5.5rem);
    line-height: 0.95;
    letter-spacing: -0.025em;
    color: var(--l-text);
  }

  .lede {
    margin-top: 1.25rem;
    max-width: 36rem;
    font-size: 1.05rem;
    color: var(--l-text-muted);
  }

  .grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(3, 1fr);
  }

  @media (max-width: 880px) {
    .grid {
      grid-template-columns: 1fr;
      gap: 0.85rem;
    }
  }

  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1.6rem 1.5rem 1.35rem;
    min-height: 14rem;
    background: var(--l-surface);
    border: 1px solid var(--l-border);
    border-radius: var(--l-radius-lg);
    color: var(--l-text);
    text-decoration: none;
    box-shadow: var(--l-shadow-sm);
    transition:
      transform 180ms cubic-bezier(0.2, 0.7, 0.3, 1),
      box-shadow 180ms ease,
      border-color 180ms ease;
    isolation: isolate;
    overflow: hidden;
  }

  .tile::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(180deg, var(--tile-accent-soft) 0%, transparent 38%);
    opacity: 0;
    transition: opacity 200ms ease;
    z-index: -1;
  }

  .tile:hover,
  .tile:focus-visible {
    transform: translateY(-3px);
    border-color: var(--tile-accent);
    box-shadow: var(--l-shadow-md);
  }

  .tile:hover::before,
  .tile:focus-visible::before {
    opacity: 0.5;
  }

  .tile:focus-visible {
    outline: 2px solid var(--tile-accent);
    outline-offset: 3px;
  }

  .tile-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--l-radius-md);
    background: var(--tile-accent-soft);
    color: var(--tile-accent);
  }

  .tile-title {
    font-family: var(--l-font-serif);
    font-weight: 500;
    font-variation-settings: 'opsz' 36;
    font-size: 1.5rem;
    line-height: 1.1;
    letter-spacing: -0.015em;
    color: var(--l-text);
  }

  .tile-hook {
    font-size: 0.92rem;
    color: var(--l-text-muted);
    line-height: 1.5;
    flex: 1;
  }

  .tile-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.4rem;
    padding-top: 0.85rem;
    border-top: 1px dashed var(--l-border);
  }

  .tile-path {
    font-family: var(--l-font-mono);
    font-size: 0.78rem;
    color: var(--l-text-subtle);
    letter-spacing: -0.005em;
  }

  .tile-arrow {
    display: inline-flex;
    align-items: center;
    color: var(--tile-accent);
    transition: transform 200ms cubic-bezier(0.2, 0.7, 0.3, 1);
  }

  .tile:hover .tile-arrow,
  .tile:focus-visible .tile-arrow {
    transform: translateX(4px);
  }

  .foot {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--l-border);
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.85rem;
    color: var(--l-text-subtle);
  }

  .foot a {
    color: var(--l-text-muted);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition:
      color 120ms ease,
      border-color 120ms ease;
  }

  .foot a:hover {
    color: var(--l-accent);
    border-bottom-color: var(--l-accent);
  }

  .sep {
    opacity: 0.5;
  }
</style>
