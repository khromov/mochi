<main>
  <p class="loading" role="status">Loading…</p>
</main>

<style>
  main {
    max-width: 32rem;
    margin: 2rem auto;
    padding: 0 1rem;
    font-family: system-ui, sans-serif;
  }
  .loading {
    color: #666;
  }
  .loading::after {
    content: '';
    display: inline-block;
    width: 0.75em;
    height: 0.75em;
    margin-left: 0.5em;
    vertical-align: -0.1em;
    border: 2px solid #999;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
