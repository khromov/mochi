<script lang="ts">
  import PageShell from './components/PageShell.svelte';
  import Footer from './components/Footer.svelte';
  import QuickStart from './components/QuickStart.svelte';
  import { demos, categoryLabels, categoryOrder, type DemoCategory, type Demo } from './lib/demos';
  import { demoIconFor } from './lib/demoIcons';
  import { isExternal } from './lib/isExternal';
  import type { TocEntry } from './lib/toc';

  let { docsNav, firstDocSlug }: { docsNav: TocEntry[]; firstDocSlug: string } = $props();

  const grouped: Array<{ category: DemoCategory; label: string; items: Demo[] }> = categoryOrder
    .map((category) => ({
      category,
      label: categoryLabels[category],
      items: demos.filter((d) => d.category === category),
    }))
    .filter((g) => g.items.length > 0);
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<PageShell
  {docsNav}
  metaTags={{
    title: 'Mochi — SSR Framework for Svelte 5 + Bun',
    titleTemplate: '%s',
    canonical: 'https://mochi.fast/',
  }}
>
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
    <section class="docs-cta">
      <h2 class="docs-cta-title">What is Mochi?</h2>
      <p class="lead">
        Mochi is a lightweight, server-first framework for Svelte 5 on Bun. Mochi websites render server-side on every request and ship as plain HTML. Components only ship
        JavaScript when you explicitly mark them as
        <a href="/docs/intro/#server-rendered-with-island-interactivity">islands</a>.
      </p>
    </section>

    <QuickStart mochi:hydrate />

    <section class="docs-cta">
      <h2 class="docs-cta-title">Documentation</h2>
      <p class="docs-cta-blurb">Setup, hydration modes, routes, hooks, forms, cookies — everything in one place.</p>
      <a class="docs-cta-link" href="/docs/{firstDocSlug}/">Start reading →</a>
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

  .lead {
    color: var(--text-muted);
    font-size: 1.05rem;
    line-height: 1.6;
    margin: 0;
  }

  .lead a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
  }

  .lead a:hover {
    text-decoration: underline;
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
    font-size: 1.05rem;
    line-height: 1.6;
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
