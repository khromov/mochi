<script lang="ts">
  import PageShell from './components/PageShell.svelte';
  import Footer from './components/Footer.svelte';
  import ReadmeCopy from './components/ReadmeCopy.svelte';
  import DocsToc from './components/DocsToc.svelte';
  import type { TocEntry } from './lib/toc';
  import { docHref } from './lib/toc';
  import type { DocNeighbor } from './lib/docs';
  import { docComponents } from './lib/docComponents.generated';

  let {
    slug,
    title,
    docsNav,
    toc,
    prev,
    next,
  }: {
    slug: string;
    title: string;
    docsNav: TocEntry[];
    toc: TocEntry[];
    prev: DocNeighbor | null;
    next: DocNeighbor | null;
  } = $props();

  const DocComponent = $derived(docComponents[slug]);
</script>

<svelte:head>
  <title>{title} — Mochi</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<PageShell {docsNav} currentSlug={slug}>
  <header class="hero">
    <div class="hero-inner">
      <a class="logo" href="/">🍡 mochi</a>
      <p class="tagline">SSR framework for Svelte 5 + Bun with islands-based selective hydration</p>
    </div>
  </header>

  <main class="body">
    <section class="readme">
      <ReadmeCopy mochi:hydrate {slug} />
      <DocsToc {toc} />
      {#if DocComponent}
        <DocComponent />
      {:else}
        <p>Doc not found.</p>
      {/if}

      {#if prev || next}
        <nav class="doc-pager" aria-label="Doc pagination">
          {#if prev}
            <a class="doc-pager-link prev" href={docHref(prev.slug)}>
              <span class="doc-pager-label">← Previous</span>
              <span class="doc-pager-title">{prev.title}</span>
            </a>
          {/if}
          {#if next}
            <a class="doc-pager-link next" href={docHref(next.slug)}>
              <span class="doc-pager-label">Next →</span>
              <span class="doc-pager-title">{next.title}</span>
            </a>
          {/if}
        </nav>
      {/if}
    </section>
  </main>

  <Footer />
</PageShell>

<style>
  .hero {
    padding: 3rem 1.5rem;
  }

  .hero-inner {
    position: relative;
    max-width: 600px;
    margin: 0 auto;
  }

  .logo {
    display: inline-block;
    font-family: var(--font-serif);
    font-size: 3.25rem;
    font-weight: 400;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
    color: #fff;
    letter-spacing: -0.015em;
    margin-bottom: 0.5rem;
    text-decoration: none;
  }

  .tagline {
    font-family: var(--font-serif);
    font-weight: 300;
    color: #d8e4dc;
    font-size: 1.05rem;
    line-height: 1.5;
    letter-spacing: 0.005em;
    margin-bottom: 0;
  }

  .body {
    max-width: 800px;
    width: 100%;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    flex: 1;
  }

  .readme {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.5rem 1.75rem;
    margin-bottom: 1.5rem;
    box-shadow: var(--shadow-md);
    color: var(--text);
    font-size: 1.1875rem;
    line-height: 1.65;
    overflow-wrap: break-word;
  }

  .readme :global(h1) {
    font-family: var(--font-serif);
    font-size: 2.25rem;
    font-weight: 400;
    font-variation-settings: 'opsz' 144;
    margin: 0 0 0.5rem;
    color: var(--text);
    letter-spacing: -0.01em;
    scroll-margin-top: 4px;
  }

  .readme :global(h2) {
    font-family: var(--font-serif);
    font-size: 1.75rem;
    font-weight: 500;
    margin: 0 0 0.5rem;
    color: var(--text);
    scroll-margin-top: 0;
  }

  .readme :global(h2 ~ h2) {
    margin-top: 1.75rem;
    border-top: 1px solid var(--border);
    padding-top: 1.25rem;
  }

  .readme :global(h3) {
    font-family: var(--font-serif);
    font-size: 1.5rem;
    font-weight: 500;
    letter-spacing: -0.003em;
    margin: 1.25rem 0 0.4rem;
    color: var(--text);
    scroll-margin-top: 4px;
  }

  .readme :global(h4) {
    font-size: 1.1875rem;
    font-weight: 600;
    margin: 1rem 0 0.3rem;
    color: var(--text-muted);
  }

  .readme :global(p) {
    margin: 0 0 0.75rem;
    color: var(--text-muted);
  }

  .readme :global(blockquote) {
    margin: 0.75rem 0;
    padding: 0.5rem 0.9rem;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  .readme :global(blockquote p:last-child) {
    margin-bottom: 0;
    color: inherit;
  }

  .readme :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-color: rgba(74, 124, 89, 0.35);
    text-underline-offset: 3px;
    transition: color 0.12s ease;
  }

  .readme :global(a:hover) {
    color: var(--accent-hover);
    text-decoration-color: currentColor;
  }

  .readme :global(ul),
  .readme :global(ol) {
    margin: 0 0 0.75rem;
    padding-left: 1.4rem;
  }

  .readme :global(li) {
    margin-bottom: 0.2rem;
  }

  /* Inline code only — exclude `<pre><code>` blocks, which get their styling
     from the global `pre` / `pre code` rules in shell.html. */
  .readme :global(:not(pre) > code) {
    font-family: var(--font-mono);
    font-size: 0.82em;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    color: var(--accent-hover);
  }

  .readme :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 1rem;
    font-size: 1.0625rem;
    display: block;
    overflow-x: auto;
  }

  .readme :global(th),
  .readme :global(td) {
    border: 1px solid var(--border);
    padding: 0.4rem 0.6rem;
    text-align: left;
    vertical-align: top;
  }

  .readme :global(th) {
    background: var(--surface-muted);
    font-weight: 600;
  }

  .readme :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1.5rem 0;
  }

  .doc-pager {
    display: flex;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .readme .doc-pager-link {
    display: block;
    flex: 0 0 calc(45% - 0.5rem);
    min-width: 0;
    padding: 0.6rem 0.85rem;
    background: var(--surface-muted);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    color: var(--text);
    text-decoration: none;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  .readme .doc-pager-link:hover {
    background: var(--accent-soft);
    border-color: var(--accent-hover);
    color: var(--accent-hover);
    text-decoration: none;
  }

  .doc-pager-link.next {
    margin-left: auto;
    text-align: right;
  }

  .doc-pager-label {
    display: block;
    font-size: 0.7rem;
    font-weight: 600;
    color: inherit;
    opacity: 0.75;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .doc-pager-title {
    display: block;
    margin-top: 0.15rem;
    font-size: 0.9rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 768px) {
    .hero {
      padding: 1.5rem 1.25rem;
    }

    .logo {
      font-size: 2.2rem;
    }

    .body {
      max-width: none;
      background: var(--surface);
    }

    .readme {
      background: transparent;
      border: 0;
      border-radius: 0;
      padding: 0;
      margin-bottom: 0;
      box-shadow: none;
    }

    .readme :global(h1) {
      font-size: 1.875rem;
      scroll-margin-top: 60px;
    }

    .readme :global(h2) {
      scroll-margin-top: 60px;
    }

    .readme :global(h3) {
      scroll-margin-top: 60px;
    }

    .doc-pager {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }

    .readme .doc-pager-link.next {
      flex: 0 0 auto;
      width: 100%;
      text-align: left;
      margin-left: 0;
    }

    .readme .doc-pager-link.prev {
      flex: 0 0 auto;
      width: auto;
      padding: 0;
      background: transparent;
      border: 0;
      border-radius: 0;
      color: var(--text-muted);
      font-size: 0.8rem;
    }

    .readme .doc-pager-link.prev:hover {
      background: transparent;
      border-color: transparent;
      color: var(--accent-hover);
    }

    .doc-pager-link.prev .doc-pager-label {
      display: inline;
      font-size: 0.8rem;
      font-weight: 500;
      letter-spacing: 0;
      text-transform: none;
      opacity: 1;
    }

    .doc-pager-link.prev .doc-pager-label::after {
      content: '·';
      margin: 0 0.4rem;
    }

    .doc-pager-link.prev .doc-pager-title {
      display: inline;
      margin-top: 0;
      font-size: 0.8rem;
      font-weight: 400;
    }
  }
</style>
