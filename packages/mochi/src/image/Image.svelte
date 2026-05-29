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
  style:background-image={blur ? `url(${blur})` : undefined}
  style:background-size={blur ? 'cover' : undefined}
  style:background-position={blur ? 'center' : undefined}
/>
