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
