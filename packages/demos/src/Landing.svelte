<script lang="ts">
  import '@fontsource-variable/fraunces/full.css';
  import '@fontsource-variable/public-sans';
  import Newspaper from '@lucide/svelte/icons/newspaper';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import type { Component } from 'svelte';

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
    margin-bottom: clamp(2.5rem, 6vw, 4rem);
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
