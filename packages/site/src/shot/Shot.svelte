<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import CaptchaShot from './subjects/CaptchaShot.svelte';
  import ImageShot from './subjects/ImageShot.svelte';
  import LikeButton from '../demos/your-first-mochi-app/LikeButton.svelte';

  // `props` arrives as an opaque bag: the route resolves it by name via registry.ts,
  // which is what guarantees the shape each branch below casts it to.
  let {
    name,
    width,
    height,
    scale,
    natural,
    props,
  }: {
    name: string;
    width: number;
    height: number;
    scale: number;
    natural: { width: number; height: number };
    props: Record<string, unknown>;
  } = $props();
</script>

<div class="shot" style="width: {width}px; height: {height}px">
  <!-- transform (not width/height) sizes this so the subject lays out at its designed
       size and is only magnified — stretching would reflow it into a different design. -->
  <div class="fit" style="width: {natural.width}px; height: {natural.height}px; transform: scale({scale})">
    <!-- A branch (not a dynamic <Subject />) because the island preprocessor only reads
         mochi:hydrate off a static invocation of a statically-known component; captcha
         mounts CaptchaShot as plain SSR since MochiCaptcha already hydrates inside it. -->
    {#if name === 'captcha'}
      <CaptchaShot {...props as ComponentProps<typeof CaptchaShot>} />
    {:else if name === 'like'}
      <LikeButton mochi:hydrate {...props as ComponentProps<typeof LikeButton>} />
    {:else if name === 'image-placeholder'}
      <!-- No mochi:hydrate: <Image> renders a plain <img> and ships no client JS, so there's no island here. -->
      <ImageShot {...props as ComponentProps<typeof ImageShot>} />
    {/if}
  </div>
</div>

<style>
  /* The frame is the screenshot: exact pixels, pinned to the top-left corner so a
     viewport of the same size captures it edge-to-edge with nothing else in view. */
  .shot {
    position: fixed;
    inset: 0 auto auto 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    overflow: hidden;
  }

  /* transform doesn't affect layout, so flex still centres the unscaled box evenly,
     and centres this element's own content too so an undersized subject isn't pinned top-left. */
  .fit {
    display: flex;
    align-items: center;
    justify-content: center;
    transform-origin: center;
    flex: none;
  }

  /* Hides the dev toolbar, which would otherwise sit across the bottom of every shot;
     :global is safe since this page's CSS ships only with this page. */
  :global(#mochi-dev-toolbar) {
    display: none;
  }
</style>
