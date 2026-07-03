<script lang="ts">
  // Server-rendered image component: emits a single <img> pointing at a signed,
  // cached, resized URL. With `placeholder`, the ThumbHash blur is set as the
  // <img>'s own background-image — it shows through until the real image paints
  // over it, so the blur-up needs zero client JS.
  //
  // Inside a mochi:hydrate* island `isHydratable()` is true (it propagates to
  // the whole island subtree, so a nested `<Image>` sees it too). Minting needs
  // the server secret, so there the minted values are wrapped in `hydratable` —
  // devalue-serialized into the page and reused during hydration instead of
  // re-minted in the browser. In pure SSR nothing is serialized: the snapshot
  // would print `src` into the markup for no benefit, undoing the encrypted
  // token's whole point. In the island case that's fine — island props (and the
  // island's client JS) already expose `src` to the client.
  //
  // The mochi-framework imports go through the virtual module, whose client
  // build ships throwing stubs instead of the node-only crypto/fs/dns graph; the
  // stubs are never called because browser-side minting (changed props after
  // hydration) degrades to the raw source URL instead.
  import { hydratable } from 'svelte';
  import { getResizedImage, getImagePlaceholder, isHydratable } from 'mochi-framework';
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

  const hydrating = isHydratable();
  const isBrowser = typeof window !== 'undefined';
  const mintUrl = () => (isBrowser ? src : getResizedImage(src, { width, height, quality, format, fit }));
  const mintBlur = () => (isBrowser ? null : getImagePlaceholder(src));
  const key = $derived(`mochi:image:${JSON.stringify([src, width, height, quality, format, fit])}`);
  const resized = $derived(hydrating ? hydratable(key, mintUrl) : mintUrl());
  const blur = $derived(placeholder ? await (hydrating ? hydratable(`${key}#placeholder`, mintBlur) : mintBlur()) : null);
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
