<script lang="ts">
  import ThemeToggle from '../components/ThemeToggle.svelte';
  import GitHubButton from '../components/GitHubButton.svelte';

  let { firstDocSlug, themeToggle = true }: { firstDocSlug: string; themeToggle?: boolean } = $props();
</script>

<header class="topnav">
  <nav class="topnav-inner" aria-label="Main">
    <a class="brand" href="/"><span aria-hidden="true">🍡</span> mochi</a>
    <ul class="links">
      <li><a href="/docs/{firstDocSlug}/">Docs</a></li>
      <li><a href="#demos">Demos</a></li>
      <li><a href="/blog/">Blog</a></li>
      <li><a href="/docs/changelog/">Changelog</a></li>
    </ul>
    <div class="actions">
      <GitHubButton compact />
      {#if themeToggle}
        <ThemeToggle mochi:hydrate compact />
      {/if}
      <a class="cta" href="/docs/{firstDocSlug}/">Get started</a>
    </div>
  </nav>
</header>

<style>
  .topnav {
    position: relative;
    z-index: 5;
    background: var(--nav-bg, transparent);
    color: var(--nav-text, var(--text));
    border-bottom: 1px solid var(--nav-border, var(--border));
  }

  .topnav-inner {
    display: flex;
    align-items: center;
    gap: 2rem;
    max-width: var(--nav-max, 1200px);
    margin: 0 auto;
    padding: 0.85rem 2rem;
  }

  .brand {
    font-family: var(--nav-brand-font, var(--font-serif));
    font-size: 1.35rem;
    font-weight: var(--nav-brand-weight, 500);
    letter-spacing: -0.01em;
    color: inherit;
    text-decoration: none;
    white-space: nowrap;
  }

  .links {
    display: flex;
    gap: 1.5rem;
    list-style: none;
    margin-right: auto;
  }

  .links a {
    font-size: 0.92rem;
    font-weight: 500;
    color: var(--nav-muted, var(--text-muted));
    text-decoration: none;
    transition: color 0.12s ease;
  }

  .links a:hover {
    color: var(--nav-text, var(--text));
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .cta {
    margin-left: 0.4rem;
    padding: 0.5rem 1rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--nav-cta-text, var(--accent-text));
    background: var(--nav-cta-bg, var(--accent));
    border-radius: var(--nav-cta-radius, var(--radius-md));
    text-decoration: none;
    white-space: nowrap;
    transition: filter 0.12s ease;
  }

  .cta:hover {
    filter: brightness(1.08);
  }

  @media (max-width: 768px) {
    .topnav {
      display: none;
    }
  }
</style>
