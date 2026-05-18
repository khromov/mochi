<footer class="footer">
  <div class="footer-inner">
    <a class="footer-mark" href="/">
      <span class="footer-mark-glyph" aria-hidden="true">🍡</span>
      <span class="footer-mark-word">mochi</span>
    </a>

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

  @media (max-width: 640px) {
    .footer-inner {
      flex-direction: column;
      align-items: flex-start;
    }

    .footer-colophon {
      text-align: left;
      max-width: none;
    }
  }
</style>
