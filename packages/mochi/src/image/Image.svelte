<script lang="ts">
  // Server-rendered image component: emits a single <img> pointing at a signed
  // URL for a named size declared in Mochi.serve({ image: { sizes } }).
  // Minting is synchronous and near-instant — the fetch/transform happens lazily
  // in the /_mochi/image endpoint on the browser's request, so SSR is never
  // blocked. With `placeholder`, a cached ThumbHash blur (if already computed) is
  // set as the <img>'s own background-image and paints with zero client JS; on a
  // cold cache the blur is warmed in the background and appears on a later render.
  //
  // Inside a hydrating island — at any nesting depth, detected via
  // `isHydratable()` — minting needs the server secret, so the minted values
  // are wrapped in `hydratable` — devalue-serialized into the page and reused
  // during hydration instead of re-minted in the browser. Outside (pure SSR)
  // nothing is serialized. The import goes through the `mochi-framework` virtual
  // module, whose client build ships stubs (getImageAttrs returns the raw src).
  import { hydratable } from 'svelte';
  import { getImageAttrs, imagePlaceholder, isHydratable } from 'mochi-framework';

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
  }: {
    src: string;
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
  } = $props();

  const hydratableSubtree = isHydratable();
  const isBrowser = typeof window !== 'undefined';
  const mintAttrs = () => (isBrowser ? { url: src } : getImageAttrs(src, size));
  const mintBlur = () => (isBrowser ? null : imagePlaceholder(src));
  const key = $derived(`mochi:image:${JSON.stringify([src, size])}`);
  const attrs = $derived(hydratableSubtree ? hydratable(key, mintAttrs) : mintAttrs());
  const blur = $derived(placeholder ? await (hydratableSubtree ? hydratable(`${key}#placeholder`, mintBlur) : mintBlur()) : null);
  const imgWidth = $derived(width ?? attrs.width);
  const imgHeight = $derived(height ?? attrs.height);
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
