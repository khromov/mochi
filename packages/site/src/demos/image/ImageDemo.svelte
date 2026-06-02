<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import ImageCredits from '../../components/ImageCredits.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { Image } from 'mochi-framework/image';
  import { getResizedImage, getImage, getImagePlaceholder } from 'mochi-framework';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';

  const remote = 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-1.jpg';

  const gallery = Array.from({ length: 14 }, (_, i) => `https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-${i + 1}.jpg`);

  const directUrl = getResizedImage(remote, { width: 400, height: 400, fit: 'inside', format: 'jpeg', quality: 60 });

  const originalUrl = getImage(remote);

  const blur = await getImagePlaceholder(remote);

  const sources = await loadSources([
    { label: 'ImageDemo.svelte', path: './src/demos/image/ImageDemo.svelte' },
    { label: 'routes.ts', path: './src/demos/image/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Image Resizing"
  description="On-the-fly image resizing on Bun.Image, served from an encrypted, stale-while-revalidate disk cache. Every URL's payload is AES-256-GCM encrypted, so the source and params stay hidden and can't be tampered with."
  {sources}
>
  <h3>Component</h3>
  <p>A plain <code>&lt;Image&gt;</code> renders a single resized <code>&lt;img&gt;</code> with no client JS:</p>
  <div class="frame">
    <Image src={remote} width={640} height={400} alt="A resized random photo" />
  </div>

  <h3>With a blur placeholder</h3>
  <p>
    Add <code>placeholder</code> to show a ThumbHash blur until the image loads — it's the <code>&lt;img&gt;</code>'s own <code>background-image</code>, so no client JS is needed.
    The placeholder shows first, then the loaded image that paints over it:
  </p>
  {#if blur}
    <div class="frame blur-compare">
      <span class="blur-compare__placeholder" style:background-image="url({blur})" role="img" aria-label="ThumbHash blur placeholder"></span>
      <span class="blur-compare__arrow"><ArrowDown size={28} aria-hidden="true" /></span>
      <Image src={remote} width={600} height={400} placeholder alt="A resized random photo with blur-up" />
    </div>
  {:else}
    <div class="frame">
      <Image src={remote} width={600} height={400} alt="A resized random photo with blur-up" placeholder />
    </div>
  {/if}

  <h3>Programmatic</h3>
  <p><code>getResizedImage()</code> returns a signed URL you can use anywhere:</p>
  <pre class="url">{directUrl}</pre>
  <div class="frame">
    <img src={directUrl} width={400} alt="Resized via getResizedImage()" />
  </div>
  <p class="note">
    This uses the default <code>fit: 'inside'</code>, which preserves aspect ratio and fits <em>within</em> the 400&times;400 box — so this 3:2 photo becomes 400&times;267. Pass
    <code>fit: 'fill'</code>
    to force an exact square (stretching); <code>Bun.Image</code> has no crop/cover mode.
  </p>

  <h3>Full-size original</h3>
  <p>
    <code>getImage()</code> returns a signed URL for the un-resized original — fetched once and shared, so every resized variant above reuses this one cached download:
  </p>
  <pre class="url">{originalUrl}</pre>
  <div class="frame">
    <img src={originalUrl} width={400} alt="Full-size original via getImage()" />
  </div>

  <h3>Gallery</h3>
  <p>
    Fourteen source photos, each resized to a square <code>&lt;img&gt;</code> on the fly with a <code>placeholder</code> blur-up — all server-rendered, zero client JS:
  </p>
  <div class="grid">
    {#each gallery as src, i (src)}
      <Image {src} width={400} height={400} fit="inside" placeholder alt="Gallery photo {i + 1}" class="grid__img" />
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
  .url {
    overflow-x: auto;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 0.8rem;
  }
  .note {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-muted, #888);
  }
</style>
