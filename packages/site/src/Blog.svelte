<script lang="ts">
  import PageShell from './components/PageShell.svelte';
  import Footer from './components/Footer.svelte';
  import NewsletterEmbed from './components/NewsletterEmbed.svelte';
  import type { TocEntry } from './lib/toc';
  import { formatPostDate } from './lib/formatDate';

  interface PostListItem {
    slug: string;
    title: string;
    description?: string;
    date: string;
    draft: boolean;
  }

  let {
    docsNav,
    posts,
    newsletterEmbedUrl,
  }: {
    docsNav: TocEntry[];
    posts: PostListItem[];
    newsletterEmbedUrl: string;
  } = $props();
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="alternate" type="application/rss+xml" title="Mochi blog" href="https://mochi.fast/feed.xml" />
</svelte:head>

<PageShell
  {docsNav}
  metaTags={{
    title: 'Blog',
    description: 'News and deep dives from the Mochi team.',
    canonical: 'https://mochi.fast/blog/',
  }}
>
  <header class="hero-minimal">
    <div class="hero-inner">
      <a class="logo" href="/">🍡 mochi</a>
      <p class="tagline">SSR framework for Svelte 5 + Bun with islands-based selective hydration</p>
    </div>
  </header>

  <main class="body">
    <section class="post-list">
      <h1>Blog</h1>
      {#each posts as post (post.slug)}
        <article class="post-entry">
          <h2>
            <a href="/blog/{post.slug}/">{post.title}</a>
            {#if post.draft}
              <span class="draft-badge">Draft</span>
            {/if}
          </h2>
          <p class="post-date">{formatPostDate(post.date)}</p>
          {#if post.description}
            <p class="post-description">{post.description}</p>
          {/if}
        </article>
      {:else}
        <p class="post-description">No posts yet.</p>
      {/each}

      <NewsletterEmbed src={newsletterEmbedUrl} />
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

  .post-list {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.5rem 1.75rem;
    margin-bottom: 1.5rem;
    box-shadow: var(--shadow-md);
    color: var(--text);
  }

  .post-list h1 {
    font-family: var(--font-serif);
    font-size: 2.25rem;
    font-weight: 400;
    /* Fraunces' low optical size is the plain (non-decorated) cut of the face. */
    font-variation-settings: 'opsz' 9;
    margin: 0 0 1rem;
    letter-spacing: -0.01em;
  }

  .post-entry {
    padding: 1rem 0;
  }

  .post-entry + .post-entry {
    border-top: 1px solid var(--border);
  }

  .post-entry h2 {
    font-family: var(--font-serif);
    font-size: 1.5rem;
    font-weight: 500;
    margin: 0 0 0.2rem;
  }

  .post-entry h2 a {
    color: var(--text);
    text-decoration: none;
  }

  .post-entry h2 a:hover {
    color: var(--accent-hover);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .draft-badge {
    display: inline-block;
    vertical-align: middle;
    margin-left: 0.4rem;
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

  .post-date {
    margin: 0 0 0.35rem;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  .post-description {
    margin: 0;
    color: var(--text-muted);
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

    .post-list {
      background: transparent;
      border: 0;
      border-radius: 0;
      padding: 0;
      margin-bottom: 0;
      box-shadow: none;
    }

    .post-list h1 {
      font-size: 1.875rem;
    }
  }
</style>
