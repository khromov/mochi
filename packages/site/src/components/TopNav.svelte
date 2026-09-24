<script lang="ts">
  import ThemeToggle from './ThemeToggle.svelte';
  import GitHubButton from './GitHubButton.svelte';
</script>

<header class="topnav">
  <div class="topnav-inner">
    <a class="brand" href="/">
      <span aria-hidden="true">🍡</span>
      <span class="brand-word">mochi</span>
    </a>
    <nav class="links" aria-label="Primary">
      <a href="/docs/intro/">Docs</a>
      <a href="#demos">Demos</a>
      <a href="/blog/">Blog</a>
      <a class="hide-sm" href="/docs/changelog/">Changelog</a>
    </nav>
    <div class="actions">
      <ThemeToggle mochi:hydrate compact />
      <GitHubButton />
    </div>
  </div>
</header>

<style>
  .topnav {
    position: sticky;
    top: 0;
    z-index: 20;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }

  .topnav-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0.7rem 1.5rem;
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    color: var(--text);
    text-decoration: none;
    font-family: var(--font-serif);
    font-size: 1.25rem;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .links {
    display: flex;
    gap: 1.25rem;
    margin-right: auto;
  }

  .links a {
    color: var(--text-muted);
    text-decoration: none;
    font-size: 0.92rem;
  }

  .links a:hover {
    color: var(--text);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  @media (max-width: 640px) {
    .topnav-inner {
      padding: 0.6rem 1rem;
      gap: 1rem;
    }

    .links {
      gap: 0.9rem;
    }

    .hide-sm {
      display: none;
    }
  }
</style>
