<script lang="ts">
  import '@fontsource/public-sans';
  import '@fontsource-variable/fraunces/full.css';
  import Footer from './components/Footer.svelte';
  import SupportForm from './SupportForm.svelte';
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Support — Mochi</title>
  <meta name="description" content="Commercial support, consulting, and bespoke development for Mochi." />
  <link rel="canonical" href="https://support.mochi.fast/" />
</svelte:head>

<div class="page">
  <header class="hero-minimal">
    <div class="hero-inner">
      <a class="logo" href="https://mochi.fast/">🍡 mochi</a>
      <p class="tagline">SSR framework for Svelte 5 + Bun with islands-based selective hydration</p>
    </div>
  </header>

  <main class="body">
    <section class="support-card">
      <h1>Support</h1>
      <h2>Community support</h2>
      <p>
        The fastest way to get help from the community is the <a href="https://mochi.fast/discord/">Mochi Discord</a> — ask questions, share what you're building, and get answers from
        other Mochi users and the team.
      </p>
      <h2>Commercial support</h2>
      <p>Need help taking Mochi to production? We offer commercial services for teams building on the framework:</p>
      <ul>
        <li><strong>Enterprise support &amp; consulting</strong> — priority help, guidance, and hands-on assistance for your team.</li>
        <li><strong>Bespoke feature development</strong> — custom framework features built for your use case.</li>
        <li><strong>Architecture &amp; scaling</strong> — designing and scaling Mochi applications.</li>
      </ul>
      <h2>Get in touch</h2>
      <SupportForm mochi:hydrate />
      <p class="back-link"><a href="https://mochi.fast/docs/">← Back to the Mochi docs</a></p>
    </section>
  </main>

  <Footer />
</div>

<style>
  /* Stands in for PageShell's .main-col, which `.body { flex: 1 }` relied on to
     push the footer to the bottom on short pages. */
  .page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

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

  .support-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.5rem 1.75rem;
    margin-bottom: 1.5rem;
    box-shadow: var(--shadow-md);
    color: var(--text);
    font-size: 1.1875rem;
    line-height: 1.65;
  }

  .support-card h1 {
    font-family: var(--font-serif);
    font-size: 2.25rem;
    font-weight: 400;
    /* Fraunces' low optical size is the plain (non-decorated) cut of the face. */
    font-variation-settings: 'opsz' 9;
    margin: 0 0 1rem;
    letter-spacing: -0.01em;
  }

  .support-card p {
    margin: 0 0 1rem;
    color: var(--text-muted);
  }

  .support-card p:last-child {
    margin-bottom: 0;
  }

  .support-card ul {
    margin: 0 0 1rem;
    padding-left: 1.25rem;
    color: var(--text-muted);
  }

  .support-card li {
    margin-bottom: 0.5rem;
  }

  .support-card strong {
    color: var(--text);
  }

  .support-card h2 {
    font-family: var(--font-serif);
    font-size: 1.5rem;
    font-weight: 500;
    margin: 1.5rem 0 0.75rem;
  }

  .support-card a {
    color: var(--accent-hover);
    text-underline-offset: 3px;
  }

  /* Scoped under .support-card to outrank `.support-card p`'s margin reset. */
  .support-card .back-link {
    margin: 1.5rem 0 0;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border);
    font-size: 0.95rem;
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

    .support-card {
      background: transparent;
      border: 0;
      border-radius: 0;
      padding: 0;
      margin-bottom: 0;
      box-shadow: none;
    }

    .support-card h1 {
      font-size: 1.875rem;
    }
  }
</style>
