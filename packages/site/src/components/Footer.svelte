<script lang="ts">
  let { wide = false }: { wide?: boolean } = $props();
</script>

<footer class="footer" class:wide>
  <div class="footer-inner">
    <a class="footer-mark" href="/">
      <span class="footer-mark-glyph" aria-hidden="true">🍡</span>
      <span class="footer-mark-word">mochi</span>
    </a>

    <nav class="footer-links" aria-label="Footer">
      <ul>
        <li><a href="/docs/intro/">Docs</a></li>
        <li><a href="/demos/">Demos</a></li>
        <li><a href="/blog/">Blog</a></li>
        <li><a href="/docs/changelog/">Changelog</a></li>
      </ul>
      <ul>
        <li><a href="https://github.com/khromov/mochi" target="_blank" rel="noopener noreferrer">GitHub</a></li>
        <li><a href="/discord/">Discord</a></li>
        <li><a href="https://www.npmjs.com/package/mochi-framework" target="_blank" rel="noopener noreferrer">npm</a></li>
        <li><a href="/blog/#newsletter">Newsletter</a></li>
      </ul>
    </nav>

    <p class="footer-colophon">
      <span class="colophon-label">Colophon</span>
      <span class="colophon-body">
        Made with
        <span class="footer-heart" aria-hidden="true">♥</span> in 🇸🇪 Sweden and 🌍 globally.
      </span>
    </p>
  </div>
</footer>

<style>
  .footer {
    border-top: 1px solid var(--border);
    padding: 1.75rem 1.5rem;
    background: var(--surface);
  }

  .footer-inner {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .wide .footer-inner {
    max-width: calc(1200px - 3rem);
  }

  .footer-mark {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    text-decoration: none;
    color: var(--text);
    font-family: var(--font-serif);
    font-weight: 500;
    font-size: 1.15rem;
    letter-spacing: -0.01em;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
  }

  .footer-mark-glyph {
    font-size: 1.1em;
  }

  .footer-links {
    display: flex;
    gap: 2.5rem;
  }

  .footer-links ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
    font-size: 0.85rem;
  }

  .footer-links a {
    color: var(--text-muted);
    text-decoration: none;
  }

  .footer-links a:hover {
    color: var(--text);
  }

  .footer-links a:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .footer-colophon {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0;
    text-align: right;
    font-size: 0.82rem;
    color: var(--text-muted);
    line-height: 1.55;
    max-width: 32ch;
  }

  .colophon-label {
    font-family: var(--font-serif);
    font-variant-caps: all-small-caps;
    font-feature-settings: 'smcp';
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text-subtle);
    letter-spacing: 0.1em;
  }

  .colophon-body {
    display: inline;
  }

  .footer-heart {
    color: #c94f4f;
  }

  @media (max-width: 720px) {
    .footer.wide {
      padding-inline: 1rem;
    }
  }

  @media (max-width: 640px) {
    .footer-inner {
      flex-direction: column;
      align-items: flex-start;
    }

    .footer-links {
      gap: 2rem;
    }

    .footer-colophon {
      text-align: left;
      max-width: none;
    }
  }
</style>
