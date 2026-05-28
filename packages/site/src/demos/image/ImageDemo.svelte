<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { Image } from 'mochi-framework/components';
  import { getResizedImage } from 'mochi-framework';

  const remote = 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-1.jpg';

  const directUrl = getResizedImage(remote, { width: 200, height: 200, fit: 'inside', format: 'jpeg', quality: 60 });

  const sources = await loadSources([
    { label: 'ImageDemo.svelte', path: './src/demos/image/ImageDemo.svelte' },
    { label: 'routes.ts', path: './src/demos/image/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Image Resizing"
  description="On-the-fly image resizing on Bun.Image, served from a signed, stale-while-revalidate disk cache. Every URL is HMAC-signed, so sources can't be tampered with."
  {sources}
>
  <h3>Component</h3>
  <p>A plain <code>&lt;Image&gt;</code> renders a single resized <code>&lt;img&gt;</code> with no client JS:</p>
  <Image src={remote} width={320} height={200} alt="A resized random photo" />

  <h3>With a blur placeholder</h3>
  <p>Add <code>placeholder</code> to show a ThumbHash blur that fades out once the image loads:</p>
  <Image src={remote} width={480} height={320} alt="A resized random photo with blur-up" placeholder />

  <h3>Programmatic</h3>
  <p><code>getResizedImage()</code> returns a signed URL you can use anywhere:</p>
  <pre class="url">{directUrl}</pre>
  <img src={directUrl} width={200} alt="Resized via getResizedImage()" />
  <p class="note">
    This uses the default <code>fit: 'inside'</code>, which preserves aspect ratio and fits <em>within</em> the 200&times;200 box — so this 3:2 photo becomes 200&times;133. Pass
    <code>fit: 'fill'</code>
    to force an exact square (stretching); <code>Bun.Image</code> has no crop/cover mode.
  </p>

  <p class="credit">
    Photo by
    <a href="https://unsplash.com/@mingmeap?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText" target="_blank" rel="noopener">Minh Anh Nguyen</a>
    on
    <a
      href="https://unsplash.com/photos/white-and-pink-stone-on-brown-wooden-chopping-board-ndnNP_luXvU?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
      target="_blank"
      rel="noopener">Unsplash</a
    >
  </p>
</DemoPage>

<style>
  h3 {
    margin-top: 1.5rem;
  }
  .url {
    overflow-x: auto;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 0.8rem;
  }
  img {
    border-radius: var(--radius-md);
  }
  .note {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-muted, #888);
  }
  .credit {
    margin-top: 2rem;
    font-size: 0.8rem;
    color: var(--text-muted, #888);
  }
</style>
