<script lang="ts">
  import { isBrowser } from 'mochi-framework';

  // Custom elements reference browser-only globals (HTMLElement, customElements)
  // at module-eval time, so they must never load during SSR. Gating dynamic
  // imports on isBrowser keeps them out of the server path entirely; on the
  // client they load after hydration and call customElements.define() for each tag.
  if (isBrowser) {
    import('./click-counter.ts'); // local custom element
    import('@github/relative-time-element'); // external custom element from npm
  }
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
