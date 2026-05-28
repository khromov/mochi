<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { Image } from 'mochi-framework/components';
  import { getResizedImage } from 'mochi-framework';

  const remote = 'https://picsum.photos/seed/mochi/1200/800';

  // The programmatic helper returns a signed, cacheable URL — no fetch happens
  // until the browser requests it.
  const directUrl = getResizedImage(remote, { width: 320, height: 200, format: 'webp' });

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
  <Image src={remote} width={320} height={200} alt="A resized random photo with blur-up" placeholder />

  <h3>Programmatic</h3>
  <p><code>getResizedImage()</code> returns a signed URL you can use anywhere:</p>
  <pre class="url">{directUrl}</pre>
  <img src={directUrl} width={320} height={200} alt="Resized via getResizedImage()" />
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
</style>
