<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import ImageCredits from '../../components/ImageCredits.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import ImageIslandCard from './ImageIslandCard.svelte';
  import { Image } from 'mochi-framework/image';
  import { getImageUrl, getImagePlaceholder } from 'mochi-framework';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';

  const remote = 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-1.jpg';

  const gallery = Array.from({ length: 14 }, (_, i) => `https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-${i + 1}.jpg`);

  // Near-instant: mints a signed URL for the "square" size; no fetch/resize
  // happens here — the endpoint runs it lazily on the browser's request.
  const directUrl = getImageUrl(remote, 'square');

  // No size name → a URL for the un-resized original (shared by every variant).
  const originalUrl = getImageUrl(remote);

  const blur = await getImagePlaceholder(remote);

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Image: Pipelines"
  description="On-the-fly image transforms on Bun.Image, served from an encrypted, stale-while-revalidate disk cache. Transforms are declared once as named sizes in Mochi.serve(); <Image> and getImageUrl() only mint a signed URL, and the endpoint runs the size lazily — so SSR never blocks on image work."
  {sources}
>
  <h3>Component</h3>
  <p>
    A plain <code>&lt;Image&gt;</code> references a named size (declared in <code>image.sizes</code>) and renders a single <code>&lt;img&gt;</code> with no client JS. Minting is synchronous
    — no image is fetched or resized during SSR:
  </p>
  <div class="frame">
    <Image src={remote} size="hero" alt="A resized random photo" />
  </div>

  <h3>With a blur placeholder</h3>
  <p>
    Add <code>placeholder</code> to show a ThumbHash blur behind the image — it's the <code>&lt;img&gt;</code>'s own <code>background-image</code>, so no client JS is needed. The
    blur is computed in the background on first use (never blocking SSR), so it appears from the second render onward:
  </p>
  {#if blur}
    <div class="frame blur-compare">
      <span class="blur-compare__placeholder" style:background-image="url({blur})" role="img" aria-label="ThumbHash blur placeholder"></span>
      <span class="blur-compare__arrow"><ArrowDown size={28} aria-hidden="true" /></span>
      <Image src={remote} size="hero" placeholder alt="A resized random photo with blur-up" />
    </div>
  {:else}
    <div class="frame">
      <Image src={remote} size="hero" alt="A resized random photo with blur-up" placeholder />
    </div>
  {/if}

  <h3>Inside a hydrated island</h3>
  <p>
    <code>&lt;Image&gt;</code> also works inside a <code>mochi:hydrate</code> island: the server-minted URL is serialized into the page (via Svelte's
    <code>hydratable</code>) and reused during hydration, so the browser never needs the encryption secret. The button is live client-side state:
  </p>
  <div class="frame">
    <ImageIslandCard mochi:hydrate src={remote} />
  </div>
  <p class="note">
    Caveat: props passed to a hydrated island — like this card's <code>src</code> — are serialized in plain text into the page for hydration, so the source URL is visible to the
    client here. If your origin must stay secret, keep <code>&lt;Image&gt;</code> in server-rendered markup or a server island, whose props are encrypted.
  </p>

  <h3>Programmatic</h3>
  <p><code>getImageUrl(src, 'square')</code> returns the same encrypted URL you can use anywhere:</p>
  <pre class="url">{directUrl}</pre>
  <div class="frame">
    <img src={directUrl} width="400" alt="Resized via getImageUrl()" />
  </div>
  <p class="note">
    The <code>square</code> size uses <code>fit: 'inside'</code>, which preserves aspect ratio and fits <em>within</em> the 400&times;400 box — so this 3:2 photo becomes
    400&times;267. Set <code>fit: 'fill'</code> on the size to force an exact square (stretching); <code>Bun.Image</code> has no crop/cover mode.
  </p>

  <h3>Full-size original</h3>
  <p>
    <code>getImageUrl(src)</code> with no size name returns a URL for the un-resized original — fetched once and shared, so every variant above reuses this one cached download:
  </p>
  <pre class="url">{originalUrl}</pre>
  <div class="frame">
    <img src={originalUrl} width="400" alt="Full-size original via getImageUrl()" />
  </div>

  <h3>Gallery</h3>
  <p>
    Fourteen source photos, each rendered through the <code>square</code> size with a <code>placeholder</code> blur-up — all server-rendered, zero client JS:
  </p>
  <div class="grid">
    {#each gallery as src, i (src)}
      <Image {src} size="square" placeholder alt="Gallery photo {i + 1}" class="grid__img" />
    {/each}
  </div>

  <ImageCredits />
</DemoPage>

<style>
  h3 {
    margin-top: 1.5rem;
  }
  .frame {
    display: flex;
    justify-content: center;
    margin: 1rem 0;
  }
  .frame :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-md);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.5rem;
    margin: 1rem 0;
  }
  .grid :global(.grid__img) {
    width: 100%;
    aspect-ratio: 1 / 1;
    height: auto;
    object-fit: cover;
    display: block;
    border-radius: var(--radius-md);
  }
  .blur-compare {
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }
  .blur-compare__placeholder {
    width: 600px;
    max-width: 100%;
    aspect-ratio: 3 / 2;
    background-size: cover;
    background-position: center;
    border-radius: var(--radius-md);
  }
  .blur-compare__arrow {
    color: var(--text-muted, #888);
    line-height: 0;
  }
  /* The global `pre` style supplies the dark code background/text; only the
     size differs here — overriding the background alone would strand the
     light code text on a light surface. */
  .url {
    font-size: 0.8rem;
  }
  .note {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-muted, #888);
  }
</style>
