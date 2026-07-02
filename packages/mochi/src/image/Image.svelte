<script lang="ts">
  // Server-rendered image component: emits a single <img> pointing at a signed,
  // cached, resized URL. With `placeholder`, the ThumbHash blur is set as the
  // <img>'s own background-image — it shows through until the real image paints
  // over it, so the blur-up needs zero client JS.
  //
  // Also works inside mochi:hydrate* islands: URL minting needs the server
  // secret, so the server-minted values are wrapped in `hydratable` — they're
  // devalue-serialized into the page and reused during hydration instead of
  // re-run in the browser. The import goes through the `mochi-framework`
  // virtual module, whose client build ships throwing stubs instead of the
  // node-only crypto/fs/dns graph; the stubs are never called because a
  // post-hydration re-render with changed props skips minting entirely and
  // degrades to the raw source URL.
  import { hydratable } from 'svelte';
  import { getResizedImage, getImagePlaceholder } from 'mochi-framework';
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

  const isBrowser = typeof window !== 'undefined';
  const key = $derived(`mochi:image:${JSON.stringify([src, width, height, quality, format, fit])}`);
  const resized = $derived(hydratable(key, () => (isBrowser ? src : getResizedImage(src, { width, height, quality, format, fit }))));
  const blur = $derived(placeholder ? await hydratable(`${key}#placeholder`, () => (isBrowser ? null : getImagePlaceholder(src))) : null);
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
