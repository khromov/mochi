<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { Image } from 'mochi-framework/components';
  import { getResizedImage, getImagePlaceholder } from 'mochi-framework';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';

  const remote = 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-1.jpg';

  const directUrl = getResizedImage(remote, { width: 200, height: 200, fit: 'inside', format: 'jpeg', quality: 60 });

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
    <img src={directUrl} width={200} alt="Resized via getResizedImage()" />
  </div>
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

  <div class="credits">
    <p>
      Photo by
      <a href="https://unsplash.com/@andreas_haubold?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText" target="_blank" rel="noopener">Andreas Haubold</a>
      on
      <a
        href="https://unsplash.com/photos/a-blue-plate-topped-with-three-different-types-of-food-OTmHU9HdkHo?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        target="_blank"
        rel="noopener">Unsplash</a
      >
    </p>
    <p>
      Photo by
      <a href="https://unsplash.com/@blackieshoot?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText" target="_blank" rel="noopener">blackieshoot</a>
      on
      <a
        href="https://unsplash.com/photos/a-couple-of-doughnuts-sitting-on-top-of-wooden-sticks-lIvUMz8Wq-I?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        target="_blank"
        rel="noopener">Unsplash</a
      >
    </p>
    <p>
      Photo by
      <a href="https://unsplash.com/@mandimelanie?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText" target="_blank" rel="noopener">Amanda Lim</a>
      on
      <a
        href="https://unsplash.com/photos/a-person-wearing-gloves-and-holding-a-piece-of-food-28vJ-QrlvHQ?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        target="_blank"
        rel="noopener">Unsplash</a
      >
    </p>
    <p>
      Photo by
      <a href="https://unsplash.com/@negar_mz?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText" target="_blank" rel="noopener">Negar Mz</a>
      on
      <a
        href="https://unsplash.com/photos/a-plate-with-eggs-and-a-couple-of-sticks-on-it-6mNhcd4fr_g?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        target="_blank"
        rel="noopener">Unsplash</a
      >
    </p>
    <p>
      Photo by
      <a href="https://unsplash.com/@kanbi95?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText" target="_blank" rel="noopener">Vi Tran</a>
      on
      <a
        href="https://unsplash.com/photos/a-white-plate-topped-with-eggs-next-to-a-book-J9FAvf1-1ww?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        target="_blank"
        rel="noopener">Unsplash</a
      >
    </p>
    <p>
      Photo by
      <a href="https://unsplash.com/@hamadaxyz?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText" target="_blank" rel="noopener">Hamada</a>
      on
      <a
        href="https://unsplash.com/photos/brown-wooden-chopsticks-on-brown-wooden-chopping-board-I-1zlzFd-sQ?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        target="_blank"
        rel="noopener">Unsplash</a
      >
    </p>
    <p>
      Photo by
      <a href="https://unsplash.com/@lea_ren?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText" target="_blank" rel="noopener">Lea Ren</a>
      on
      <a
        href="https://unsplash.com/photos/a-close-up-of-a-bunch-of-cookies-with-faces-on-them-YGmhc3RZSc0?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        target="_blank"
        rel="noopener">Unsplash</a
      >
    </p>
    <p>
      Photo by
      <a href="https://unsplash.com/@granatlime?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText" target="_blank" rel="noopener">Yuliia Kucherenko</a>
      on
      <a
        href="https://unsplash.com/photos/a-small-dessert-with-a-leaf-on-top-of-it-hcss8y8qHSI?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
        target="_blank"
        rel="noopener">Unsplash</a
      >
    </p>
  </div>
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
  .credit {
    margin-top: 2rem;
    font-size: 0.8rem;
    color: var(--text-muted, #888);
  }
  .credits {
    margin-top: 1rem;
    font-size: 0.8rem;
    color: var(--text-muted, #888);
  }
  .credits p {
    margin: 0.25rem 0;
  }
</style>
