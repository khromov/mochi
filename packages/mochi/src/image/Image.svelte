<script lang="ts">
  // Server-rendered image component emitting a single `<img>` at a signed URL for a named size declared in
  // `Mochi.serve({ image: { sizes } })`. Minting is synchronous, with the fetch and transform deferred to the
  // `/_mochi/image` endpoint on the browser's request, so SSR never blocks. With `placeholder`, an already-computed
  // ThumbHash blur becomes the `<img>`'s own background-image and paints with zero client JS; a cold cache warms it in
  // the background for a later render.
  //
  // Minting needs the server secret, so inside a hydrating island — at any nesting depth, per `isHydratable()` — the
  // minted values are wrapped in `hydratable`, devalue-serialized into the page and reused during hydration. Pure SSR
  // serializes nothing. The import goes through the `mochi-framework` virtual module, whose client build ships stubs.
  import { hydratable } from 'svelte';
  import { getImageAttrs, imagePlaceholder, isHydratable } from 'mochi-framework';
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
  } = $props();

  const hydratableSubtree = isHydratable();
  // A local image import passes an object, a remote source a string, and every image API needs the normalized string:
  // the client `getImageAttrs` stub returns `{ url: src }`, and the hydratable key must serialize deterministically.
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
  const attrs = $derived(hydratableSubtree ? hydratable(key, mintAttrs) : mintAttrs());
  const blur = $derived(placeholder ? await (hydratableSubtree ? hydratable(`${key}#placeholder`, mintBlur) : mintBlur()) : null);
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
