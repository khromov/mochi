<script lang="ts">
  import '@fontsource/public-sans';
  import '@fontsource-variable/fraunces/full.css';
  import Footer from '../components/Footer.svelte';

  let { title, heading, body }: { title: string; heading: string; body: string } = $props();
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>{title}</title>
</svelte:head>

<div class="page">
  <header class="hero-minimal">
    <div class="hero-inner">
      <a class="logo" href="https://mochi.fast/">🍡 mochi</a>
    </div>
  </header>

  <main class="body">
    <section class="card">
      <h1>{heading}</h1>
      <p>{body}</p>
      <p class="back"><a href="https://mochi.fast/blog/">← Back to the blog</a></p>
    </section>
  </main>

  <Footer />
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .hero-minimal {
    padding: 1.5rem;
  }

  .hero-inner {
    text-align: center;
  }

  .logo {
    display: inline-block;
    font-family: var(--font-serif);
    font-size: 2.5rem;
    font-weight: 400;
    color: #fff;
    text-decoration: none;
  }

  .body {
    flex: 1;
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
    padding: 2rem 1.5rem 3rem;
  }

  .card {
    padding: 2rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
  }

  h1 {
    font-family: var(--font-serif);
    font-size: 1.6rem;
    font-weight: 500;
    margin-bottom: 0.75rem;
  }

  p {
    color: var(--text-muted);
    margin: 0 0 1rem;
  }

  .back {
    margin: 0;
  }

  .back a {
    color: var(--accent);
  }
</style>
