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
  <!-- Sized to the subject's natural box and scaled up from there. transform (not
       width/height) so the subject lays out at its designed size and is only
       magnified — stretching its box would reflow it into a different design. -->
  <div class="fit" style="width: {natural.width}px; height: {natural.height}px; transform: scale({scale})">
    <!-- To add a component: give it a branch here, plus a registry.ts entry carrying
         its natural size and props. A branch rather than a dynamic <Subject /> because
         the island preprocessor only reads mochi:hydrate off a static invocation of a
         default-imported .svelte file — see BUG_REPORT.md. A component that is already
         such an import (LikeButton) needs no wrapper; one that isn't (MochiCaptcha,
         a named export of mochi-framework/components) needs a thin local wrapper. -->
    {#if name === 'captcha'}
      <CaptchaShot mochi:hydrate {...props as ComponentProps<typeof CaptchaShot>} />
    {:else if name === 'like'}
      <LikeButton mochi:hydrate {...props as ComponentProps<typeof LikeButton>} />
    {:else if name === 'image-placeholder'}
      <!-- No mochi:hydrate: <Image> renders a plain <img> and ships no client JS, so
           there is no island here and nothing for the wrapper trap to catch. -->
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

  /* Scaling about the centre keeps the subject centred: transform doesn't affect
     layout, so flex still centres the unscaled box and the magnification is even.
     Centres its own content too, so a subject that doesn't fill its declared
     natural box is still centred rather than pinned to the top-left of it. */
  .fit {
    display: flex;
    align-items: center;
    justify-content: center;
    transform-origin: center;
    flex: none;
  }

  /* The dev toolbar would otherwise sit across the bottom of every shot. This page's
     CSS only ships with this page, so a bare global rule can't leak to the site. */
  :global(#mochi-dev-toolbar) {
    display: none;
  }
</style>
