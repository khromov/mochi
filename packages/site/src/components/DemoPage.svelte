<script>
  import CodeViewer from './CodeViewer.svelte';
  import PageShell from './PageShell.svelte';
  import { demoIconFor } from '../lib/demoIcons';
  import { buildDocsNav } from '../lib/docs';
  import { demos } from '../lib/demos';

  let { title, description, sources, children } = $props();

  const docsNav = await buildDocsNav();

  const moreDemos = demos
    .filter((d) => d.title !== title)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
</script>

<svelte:head>
  <title>{title} — Mochi</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<PageShell {docsNav}>
  <header class="hero">
    <div class="hero-inner">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a class="brand" href="/">🍡 mochi</a>
        <span class="sep" aria-hidden="true">/</span>
        <a class="crumb" href="/">demos</a>
        <span class="sep" aria-hidden="true">/</span>
        <span class="crumb current">{title}</span>
      </nav>
      <a class="back" href="/">← All demos</a>
    </div>
  </header>

  <main class="body">
    <div class="demo-card">
      <div class="card-header">
        <h1>{title}</h1>
        {#if demoIconFor[title]}
          {@const meta = demoIconFor[title]}
          {@const Icon = meta.icon}
          <span class="demo-icon" title={meta.label} aria-label={meta.label}>
            <Icon size={16} strokeWidth={1.6} />
          </span>
        {/if}
      </div>
      <p class="card-desc">{description}</p>
      <div class="demo-body">
        {@render children()}
      </div>
      {#if sources && sources.length > 0}
        <CodeViewer {sources} mochi:hydrate />
      {/if}
    </div>
  </main>

  {#if moreDemos.length > 0}
    <section class="more-demos">
      <div class="more-inner">
        <p class="more-label">More demos</p>
        <div class="more-grid">
          {#each moreDemos as demo (demo.href)}
            {@const meta = demoIconFor[demo.title]}
            {@const external = demo.href.startsWith('http')}
            <a class="more-card" href={demo.href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
              {#if meta}
                {@const Icon = meta.icon}
                <span class="mc-icon"><Icon size={16} strokeWidth={1.5} /></span>
              {/if}
              <span class="mc-title">{demo.title}</span>
              <span class="mc-hook">{demo.hook}</span>
            </a>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  <footer class="footer">
    <div class="footer-inner">
      <a href="/">← Back to all demos</a>
    </div>
  </footer>
</PageShell>

<style>
  .hero {
    padding: 1rem 1.25rem;
    text-align: left;
  }

  .hero-inner {
    position: relative;
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 2.25rem;
  }

  .crumbs {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-serif);
    font-size: 0.98rem;
    line-height: 1.1;
    color: #c8d4cb;
    letter-spacing: -0.003em;
  }

  .brand {
    font-weight: 500;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
    color: #fff;
    text-decoration: none;
    flex-shrink: 0;
  }

  .sep {
    color: rgba(232, 230, 221, 0.4);
    font-weight: 300;
    flex-shrink: 0;
  }

  .crumb {
    color: #c8d4cb;
    text-decoration: none;
    font-weight: 300;
    transition: color 0.12s ease;
  }

  .crumb:hover {
    color: #fff;
  }

  .crumb.current {
    color: #fff;
    font-style: italic;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .back {
    color: #c8d4cb;
    font-size: 0.82rem;
    text-decoration: none;
    white-space: nowrap;
    flex-shrink: 0;
    transition: color 0.12s ease;
  }

  .back:hover {
    color: #fff;
  }

  .body {
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    padding: 2rem 1rem;
    flex: 1;
  }

  .demo-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.25rem;
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
    overflow: hidden;
  }

  @media (min-width: 480px) {
    .demo-card {
      padding: 1.5rem;
    }
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .demo-icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-subtle);
    flex-shrink: 0;
  }

  .card-header h1 {
    font-family: var(--font-serif);
    font-size: 2rem;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--text);
  }

  .demo-body :global(h2) {
    font-family: var(--font-serif);
    font-size: 1.5rem;
    font-weight: 500;
    letter-spacing: -0.005em;
    margin: 1.25rem 0 0.35rem;
    color: var(--text);
  }

  .demo-body :global(h3) {
    font-family: var(--font-serif);
    font-size: 1.2rem;
    font-weight: 500;
    letter-spacing: -0.003em;
    margin: 1rem 0 0.3rem;
    color: var(--text);
  }

  .card-desc {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 1.02rem;
    font-weight: 400;
    color: var(--text-muted);
    line-height: 1.55;
    letter-spacing: 0.002em;
  }

  .demo-body {
    margin-top: 0.25rem;
  }

  .more-demos {
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    padding: 0 1rem 2rem;
  }

  .more-label {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-subtle);
    margin-bottom: 0.75rem;
  }

  .more-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }

  .more-card {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.85rem 0.9rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    text-decoration: none;
    transition:
      box-shadow 0.15s ease,
      transform 0.15s ease;
  }

  .more-card:hover {
    transform: translateY(-2px);
    box-shadow:
      inset 3px 0 0 var(--accent),
      var(--shadow-md);
  }

  .mc-icon {
    color: var(--text-subtle);
    display: inline-flex;
    margin-bottom: 0.1rem;
  }

  .mc-title {
    font-family: var(--font-serif);
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text);
    letter-spacing: -0.005em;
    line-height: 1.3;
  }

  .more-card:hover .mc-title {
    color: var(--accent);
  }

  .mc-hook {
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  @media (max-width: 600px) {
    .more-grid {
      grid-template-columns: 1fr;
    }
  }

  .footer {
    border-top: 1px solid var(--border);
    padding: 1.5rem;
    background: var(--surface);
  }

  .footer-inner {
    max-width: 720px;
    margin: 0 auto;
  }

  .footer-inner a {
    font-size: 0.85rem;
    color: var(--accent);
    text-decoration: underline;
    text-decoration-color: rgba(74, 124, 89, 0.35);
    text-underline-offset: 3px;
    transition: color 0.12s ease;
  }

  .footer-inner a:hover {
    color: var(--accent-hover);
    text-decoration-color: currentColor;
  }

  @media (max-width: 640px) {
    .crumbs {
      font-size: 0.9rem;
    }

    .back {
      /* Keep the crumb + back on one line; clip the crumb if needed. */
      font-size: 0.78rem;
    }
  }
</style>
