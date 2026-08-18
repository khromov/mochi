<script lang="ts">
  import PageShell from './components/PageShell.svelte';
  import Footer from './components/Footer.svelte';
  import NewsletterEmbed from './components/NewsletterEmbed.svelte';
  import type { TocEntry } from './lib/toc';
  import { formatPostDate } from './lib/formatDate';
  import { blogComponents } from './lib/blogComponents.generated';
  import { getAuthor } from './lib/authors';

  let {
    slug,
    title,
    description,
    date,
    draft,
    author,
    docsNav,
    newsletterEmbedUrl,
  }: {
    slug: string;
    title: string;
    description?: string;
    date: string;
    draft: boolean;
    author: string;
    docsNav: TocEntry[];
    newsletterEmbedUrl: string;
  } = $props();

  const PostComponent = $derived(blogComponents[slug]);
  const postAuthor = $derived(getAuthor(author));
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<PageShell
  {docsNav}
  metaTags={{
    title,
    description,
    canonical: `https://mochi.fast/blog/${slug}`,
  }}
>
  <header class="hero-minimal">
    <div class="hero-inner">
      <a class="logo" href="/">🍡 mochi</a>
      <p class="tagline">SSR framework for Svelte 5 + Bun with islands-based selective hydration</p>
    </div>
  </header>

  <main class="body">
    <section class="readme">
      <p class="post-date">
        {formatPostDate(date)}
        {#if draft}
          <span class="draft-badge">Draft</span>
        {/if}
      </p>
      {#if PostComponent}
        <PostComponent />
      {:else}
        <p>Post not found.</p>
      {/if}

      <NewsletterEmbed src={newsletterEmbedUrl} />

      <div class="author-box">
        <img class="author-avatar" src={postAuthor.avatar} alt={postAuthor.name} width="56" height="56" loading="lazy" />
        <div>
          <p class="author-name">{postAuthor.name}</p>
          {#if postAuthor.bio}
            <p class="author-bio">
              <a href={postAuthor.bio.href} target="_blank" rel="noopener noreferrer">{postAuthor.bio.label}</a>
            </p>
          {/if}
        </div>
      </div>

      <p class="post-back"><a href="/blog/">← All posts</a></p>
    </section>
  </main>

  <Footer />
</PageShell>

<style>
  .hero-minimal {
    padding: 1.5rem 1.5rem;
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

  .readme .post-date {
    margin: 0 0 0.25rem;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  .draft-badge {
    display: inline-block;
    vertical-align: middle;
    margin-left: 0.3rem;
    padding: 0.1em 0.5em;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent-soft-text);
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    border-radius: 999px;
  }

  .readme .post-back {
    margin: 1.5rem 0 0;
    font-size: 0.9rem;
  }

  .author-box {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    margin-top: 1.75rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border);
  }

  .author-box .author-avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: 1px solid var(--border);
  }

  .author-box .author-name {
    margin: 0;
    font-weight: 600;
    font-size: 1rem;
    color: var(--text);
  }

  .author-box .author-bio {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  .readme :global(h1) {
    font-family: var(--font-serif);
    font-size: 2.25rem;
    font-weight: 400;
    /* Fraunces' low optical size is the plain (non-decorated) cut of the face. */
    font-variation-settings: 'opsz' 9;
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

  /* Post images are authored at their natural pixel size (screenshots run to 1400px),
     so they must be held to the prose column rather than overflow it. The author
     avatar is its own thing and keeps its own styling. */
  .readme :global(img:not(.author-avatar)) {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0 0 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .readme :global(figure) {
    margin: 0 0 0.75rem;
  }

  /* Pull the caption up against its image; the bare-img margin is meant for prose. */
  .readme :global(figure img) {
    margin-bottom: 0.4rem;
  }

  .readme :global(figcaption) {
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text-subtle);
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
    color: var(--text-muted);
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

  @media (max-width: 768px) {
    .hero-minimal {
      padding: 1rem 1.25rem;
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
  }
</style>
