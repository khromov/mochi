<script lang="ts">
  // Pure-SSR image component: emits a single <img> pointing at a signed,
  // cached, resized URL. With `placeholder`, the ThumbHash blur is set as the
  // <img>'s own background-image — it shows through until the real image paints
  // over it, so the blur-up needs zero client JS, no extra element, and no
  // hydration.
  import { getResizedImage, getImagePlaceholder } from './getResizedImage';
  import type { ImageFit, ImageFormat } from './types';

  let {
    src,
    width,
    height,
    alt = '',
    quality,
    format,
    fit,
    loading = 'lazy',
    decoding = 'async',
    placeholder = false,
    class: className = undefined,
  }: {
    src: string;
    width?: number;
    height?: number;
    alt?: string;
    quality?: number;
    format?: ImageFormat;
    fit?: ImageFit;
    loading?: 'lazy' | 'eager';
    decoding?: 'async' | 'sync' | 'auto';
    placeholder?: boolean;
    class?: string;
  } = $props();

  const resized = $derived(getResizedImage(src, { width, height, quality, format, fit }));
  const blur = $derived(placeholder ? await getImagePlaceholder(src) : null);
</script>

<img
  src={resized}
  {width}
  {height}
  {alt}
  {loading}
  {decoding}
  class={className}
  class:mochi-blur-up={!!blur}
  style:background-image={blur ? `url(${blur})` : undefined}
  style:background-size={blur ? 'cover' : undefined}
  style:background-position={blur ? 'center' : undefined}
/>

<style>
  /* Blur-up with zero JS: the resized image paints over its ThumbHash
     background and sharpens in. Pure CSS can't hook the image's load event, so
     this animates on first paint rather than on load — fine for small resized
     images, and it degrades to an instant swap under reduced-motion. */
  .mochi-blur-up {
    animation: mochi-blur-up 0.2s ease-out both;
  }
  @keyframes mochi-blur-up {
    from {
      filter: blur(12px);
    }
    to {
      filter: blur(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mochi-blur-up {
      animation: none;
    }
  }
</style>
