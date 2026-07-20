<script lang="ts">
  // Server-rendered image component: emits a single <img> pointing at a signed
  // URL for a named size declared in Mochi.serve({ image: { sizes } }).
  // Minting is synchronous and near-instant — the fetch/transform happens lazily
  // in the /_mochi/image endpoint on the browser's request, so SSR is never
  // blocked. With `placeholder`, a cached ThumbHash blur (if already computed) is
  // set as the <img>'s own background-image and paints with zero client JS; on a
  // cold cache the blur is warmed in the background and appears on a later render.
  //
  // Inside a mochi:hydrate* island, forward the island's injected `isHydratable`
  // prop. Minting needs the server secret, so with the prop set the minted values
  // are wrapped in `hydratable` — devalue-serialized into the page and reused
  // during hydration instead of re-minted in the browser. Without it (pure SSR)
  // nothing is serialized. The import goes through the `mochi-framework` virtual
  // module, whose client build ships stubs (getImageAttrs returns the raw src).
  import { hydratable } from 'svelte';
  import { getImageAttrs, imagePlaceholder } from 'mochi-framework';
  import type { ImportedImage } from 'mochi-framework';

  let {
    src,
    size,
    alt = '',
    loading = 'lazy',
    decoding = 'async',
    placeholder = false,
    width,
    height,
    class: className = undefined,
    isHydratable = false,
  }: {
    /** An http/https URL, or the object from a local image import (`import x from './x.png'`). */
    src: string | ImportedImage;
    /** Name of a size declared in `image.sizes`. Omitted → the full-size original. */
    size?: string;
    alt?: string;
    loading?: 'lazy' | 'eager';
    decoding?: 'async' | 'sync' | 'auto';
    placeholder?: boolean;
    /** `<img width>` override (px). Defaults to the size's declared width. */
    width?: number;
    /** `<img height>` override (px). Defaults to the size's declared height. */
    height?: number;
    class?: string;
    isHydratable?: boolean;
  } = $props();

  // A local image import passes an object; a remote source passes a string.
  // Normalize to a string source (never the object) before touching any image
  // API — the client `getImageAttrs` stub returns `{ url: src }`, so it must
  // receive the URL string, and the hydratable key must serialize deterministically.
  const resolvedSrc = $derived(typeof src === 'string' ? src : src.src);
  const intrinsic = $derived(typeof src === 'object' && src !== null ? src : undefined);
  const isBrowser = typeof window !== 'undefined';
  const mintAttrs = () => {
    if (isBrowser) {
      return { url: resolvedSrc };
    }
    // Imported image with no transform: serve the static URL directly, skipping
    // the encrypted endpoint round-trip. We already know its intrinsic dimensions.
    if (intrinsic && size === undefined) {
      return { url: resolvedSrc, width: intrinsic.width, height: intrinsic.height };
    }
    return getImageAttrs(resolvedSrc, size);
  };
  const mintBlur = () => (isBrowser ? null : imagePlaceholder(resolvedSrc));
  const key = $derived(`mochi:image:${JSON.stringify([resolvedSrc, size])}`);
  const attrs = $derived(isHydratable ? hydratable(key, mintAttrs) : mintAttrs());
  const blur = $derived(placeholder ? await (isHydratable ? hydratable(`${key}#placeholder`, mintBlur) : mintBlur()) : null);
  const imgWidth = $derived(width ?? attrs.width ?? intrinsic?.width);
  const imgHeight = $derived(height ?? attrs.height ?? intrinsic?.height);
</script>

<img
  src={attrs.url}
  width={imgWidth}
  height={imgHeight}
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
