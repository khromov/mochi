<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import { getImageUrl } from 'mochi-framework';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import DeleteInspector from './DeleteInspector.svelte';

  let { src, generation, deleted = [] } = $props();

  const variants = [
    { size: 'hero', label: 'hero — 600×400', w: 600, h: 400 },
    { size: 'card', label: 'card — 400×267', w: 400, h: 267 },
    { size: 'thumb', label: 'thumb — 240×240', w: 240, h: 240 },
  ];

  // `invalidateImage()` clears the *server* cache; the `&g` nonce makes the browser
  // re-request the otherwise URL-stable images so the swap is visible immediately.
  const bust = (url) => `${url}&g=${generation}`;
  const originalUrl = bust(getImageUrl(src));

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Image Invalidation"
  description="Clear a cached image on demand with invalidateImage(). Our own source endpoint returns a random bundled photo on every fetch, so a hard invalidation — which drops the shared original and cascades to its variants — is visible the moment the sizes re-fetch together."
  {sources}
>
  <p>
    The images below all derive from <strong>one shared cached original</strong>, fetched from our own
    <code>/demos/image-invalidation/source.jpg</code> route — a <code>Mochi.file()</code> endpoint that serves a random bundled photo on every request. Hit the button to
    <code>invalidateImage(src, &lbrace; hard: true &rbrace;)</code>: it <strong>hard-deletes</strong> the cached original and cascades to every named size, so the next request
    re-fetches the source and <strong>all sizes update to the same new photo in lockstep</strong>. The <code>image:delete</code> events from that cascade are captured below and logged
    to your browser + server console.
  </p>

  <div class="actions">
    <form method="POST">
      <button type="submit">
        <RefreshCw size={16} aria-hidden="true" />
        Invalidate &amp; re-fetch
      </button>
    </form>
    {#if generation > 0}
      <span class="count">Invalidated {generation} time{generation === 1 ? '' : 's'}</span>
    {/if}
  </div>

  <DeleteInspector mochi:hydrate {deleted} />

  <h3>Shared original</h3>
  <div class="frame">
    <img src={originalUrl} alt="The shared cached original at full size" />
  </div>

  <h3>Named sizes off that original</h3>
  <p>Shown at their relative sizes on one row, so the difference is visible at a glance:</p>
  <div class="sizes">
    {#each variants as v (v.size)}
      <figure style:flex="{v.w} 1 0">
        <img src={bust(getImageUrl(src, v.size))} width={v.w} height={v.h} alt="{v.size} variant of the cached original" />
        <figcaption>{v.label}</figcaption>
      </figure>
    {/each}
  </div>

  <p class="note">
    <code>invalidateImage()</code> clears the cache on the <em>server</em>. A browser already holding a copy (via <code>Cache-Control</code> in production) keeps showing it until
    that lapses — so this demo appends a small <code>&amp;g=</code> nonce to force an immediate re-request. Pass <code>&lbrace; hard: false &rbrace;</code> (the default) instead to mark
    the original stale: the next request serves the cached bytes right away and re-fetches in the background.
  </p>
</DemoPage>

<style>
  h3 {
    margin-top: 1.5rem;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1.25rem 0;
  }
  .actions form {
    margin: 0;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 1rem;
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--accent-text);
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }
  .actions button:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .actions button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .count {
    padding: 0.2rem 0.6rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--accent-soft-text);
    background: var(--accent-soft);
    border-radius: var(--radius-sm);
  }
  .frame {
    display: flex;
    justify-content: center;
    margin: 1rem 0;
  }
  .frame :global(img) {
    max-width: 50%;
    height: auto;
    border-radius: var(--radius-md);
  }
  .sizes {
    display: flex;
    flex-wrap: nowrap;
    align-items: flex-start;
    gap: 1rem;
    margin: 1rem 0;
  }
  .sizes figure {
    margin: 0;
    min-width: 0;
  }
  .sizes :global(img) {
    width: 100%;
    height: auto;
    display: block;
    border-radius: var(--radius-md);
  }
  .sizes figcaption {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }
</style>
