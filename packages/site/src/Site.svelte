<script lang="ts">
  import PageShell from './components/PageShell.svelte';
  import Footer from './components/Footer.svelte';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import { demos, categoryLabels, categoryOrder, type DemoCategory, type Demo } from './lib/demos';
  import { demoIconFor } from './lib/demoIcons';
  import { isExternal } from './lib/isExternal';
  import type { TocEntry } from './lib/toc';

  let { docsNav, firstDocSlug }: { docsNav: TocEntry[]; firstDocSlug: string } = $props();

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

  const grouped: Array<{ category: DemoCategory; label: string; items: Demo[] }> = categoryOrder
    .map((category) => ({
      category,
      label: categoryLabels[category],
      items: demos.filter((d) => d.category === category),
    }))
    .filter((g) => g.items.length > 0);
</script>

<svelte:head>
  <title>Mochi — SSR Framework for Svelte 5 + Bun</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<PageShell {docsNav}>
  <header class="hero">
    <div class="hero-inner">
      <h1 class="logo">🍡 mochi</h1>
      <p class="lede">
        An experimental SSR framework for <span class="nowrap">Svelte 5</span> and
        <span class="nowrap">Bun</span>.
      </p>
      <p class="dek">Render everything on the server; ship JavaScript only where it earns its place.</p>
    </div>
  </header>

  <main class="body">
    <section class="quickstart" aria-label="Quick start">
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
      <p class="quickstart-note">
        Requires <a href="https://bun.sh" target="_blank" rel="noopener noreferrer">Bun</a> <code>&gt;= 1.3.13</code>.
      </p>
    </section>

    <section class="docs-cta">
      <h2 class="docs-cta-title">Documentation</h2>
      <p class="docs-cta-blurb">Setup, hydration modes, routes, hooks, forms, cookies — everything in one place.</p>
      <a class="docs-cta-link" href="/docs/{firstDocSlug}">Start reading →</a>
    </section>

    <h2 class="demos-heading">Demos</h2>

    <p class="intro">Each demo lives on its own page. Pick one below to see the feature in isolation.</p>

    <div class="demo-sections">
      {#each grouped as group (group.category)}
        <section class="demo-group" aria-labelledby="group-{group.category}">
          <h3 class="demo-group-heading" id="group-{group.category}">{group.label}</h3>
          <div class="demo-grid">
            {#each group.items as demo (demo.href)}
              {@const external = isExternal(demo.href)}
              {@const meta = demoIconFor[demo.title]}
              <a class="demo-link" href={demo.href} target={external ? '_blank' : undefined}>
                <div class="demo-link-head">
                  <span class="demo-title">{demo.title}</span>
                  {#if meta}
                    {@const Icon = meta.icon}
                    <span class="demo-icon" title={meta.label} aria-label={meta.label}>
                      <Icon size={16} strokeWidth={1.6} />
                    </span>
                  {/if}
                </div>
                <span class="demo-hook">{demo.hook}</span>
              </a>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  </main>

  <Footer />
</PageShell>

<style>
  .hero {
    padding: 3.5rem 1.5rem 3rem;
  }

  .hero-inner {
    position: relative;
    max-width: 640px;
    margin: 0 auto;
  }

  .logo {
    font-family: var(--font-serif);
    font-size: 3.25rem;
    font-weight: 400;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50,
      'WONK' 1;
    color: #fff;
    letter-spacing: -0.015em;
    margin-bottom: 0.9rem;
    line-height: 1.05;
  }

  .lede {
    font-family: var(--font-serif);
    font-weight: 400;
    color: #f4f1e8;
    font-size: 1.35rem;
    line-height: 1.35;
    letter-spacing: -0.003em;
    margin: 0 auto 0.45rem;
    max-width: 28ch;
    text-wrap: balance;
  }

  .dek {
    font-family: var(--font-serif);
    font-style: italic;
    font-weight: 300;
    color: #c8d4cb;
    font-size: 0.98rem;
    line-height: 1.5;
    letter-spacing: 0.003em;
    margin: 0 auto;
    max-width: 38ch;
    text-wrap: balance;
  }

  .nowrap {
    white-space: nowrap;
  }

  .body {
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    flex: 1;
  }

  .demos-heading {
    font-family: var(--font-serif);
    font-size: 1.75rem;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 0.35rem;
    letter-spacing: -0.02em;
  }

  .intro {
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
    margin-bottom: 1.25rem;
  }

  .demo-sections {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }

  .demo-group {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .demo-group-heading {
    font-family: var(--font-serif);
    font-variant-caps: all-small-caps;
    font-feature-settings: 'smcp';
    font-size: 1.05rem;
    font-weight: 500;
    color: var(--text-subtle);
    letter-spacing: 0.08em;
    margin-left: 0.15rem;
  }

  .demo-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 0.5rem;
    box-shadow: var(--shadow-md);
  }

  .quickstart {
    margin-bottom: 1.75rem;
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

  .docs-cta {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.5rem 1.75rem;
    margin-bottom: 1.75rem;
    box-shadow: var(--shadow-md);
  }

  .docs-cta-title {
    font-family: var(--font-serif);
    font-size: 1.35rem;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 0.5rem;
    letter-spacing: -0.01em;
  }

  .docs-cta-blurb {
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
    margin-bottom: 1rem;
  }

  .docs-cta-link {
    display: inline-block;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
    padding: 0.5rem 0.9rem;
    background: var(--accent-soft);
    border-radius: var(--radius-md);
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .docs-cta-link:hover {
    background: var(--accent);
    color: var(--surface);
  }

  .demo-link {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.75rem 0.9rem;
    border-radius: 10px;
    text-decoration: none;
    color: inherit;
    min-width: 0;
    transition: background 0.12s ease;
  }

  .demo-link:hover {
    background: var(--accent-soft);
  }

  .demo-link:hover .demo-title {
    color: var(--accent-soft-text);
  }

  .demo-link-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .demo-icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .demo-title {
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text);
    transition: color 0.12s ease;
  }

  .demo-hook {
    font-size: 0.8rem;
    color: var(--text-subtle);
    line-height: 1.4;
  }

  @media (max-width: 640px) {
    .demo-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .hero {
      padding: 2rem 1.25rem 1.75rem;
    }

    .logo {
      font-size: 2.4rem;
    }

    .lede {
      font-size: 1.15rem;
    }

    .dek {
      font-size: 0.92rem;
    }
  }
</style>
