<svelte:head>
  <title>Protected — Mochi</title>
</svelte:head>

<main>
  <h1>✅ You're cleared</h1>
  <p>
    Your browser solved the proof-of-work and holds a signed clearance cookie, so this page — and every other route
    <code>protect()</code> selects — now answers directly. The interstitial returns once the clearance expires.
  </p>
  <a href="/demos/protection/">← Back to the demo</a>
</main>

<style>
  main {
    max-width: 560px;
    margin: 4rem auto;
    padding: 0 1.5rem;
    font-size: 0.95rem;
    line-height: 1.6;
  }

  h1 {
    font-size: 1.5rem;
  }

  p {
    color: var(--text-muted, #6b665e);
  }

  code {
    font-family: var(--font-mono, monospace);
    font-size: 0.85em;
  }

  a {
    color: var(--accent, #4a7c59);
  }
</style>
