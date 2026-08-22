<script lang="ts">
  import { importWebComponent } from 'mochi-framework';

  // Rewritten at build time to a no-op on the server, so these browser-only
  // modules never load during SSR, and to a dynamic import on the client.
  await importWebComponent('./click-counter.ts'); // local custom element
  await importWebComponent('@github/relative-time-element'); // external, from npm
</script>

<div class="grid">
  <section>
    <h3>Local — <code>&lt;click-counter&gt;</code></h3>
    <p class="hint">A vanilla custom element defined in <code>click-counter.ts</code>, using shadow DOM.</p>
    <click-counter></click-counter>
  </section>

  <section>
    <h3>External — <code>&lt;relative-time&gt;</code></h3>
    <p class="hint">From the <code>@github/relative-time-element</code> npm package, bundled into the island.</p>
    <relative-time datetime="2026-01-01T00:00:00Z">Jan 1, 2026</relative-time>
  </section>
</div>

<style>
  .grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    margin-top: 1rem;
  }
  section {
    padding: 1rem 1.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  h3 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    font-weight: 600;
  }
  .hint {
    color: var(--text-muted);
    font-size: 0.85em;
    margin: 0 0 0.75rem;
  }
  code {
    font-size: 0.9em;
  }
</style>
