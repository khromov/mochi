<script lang="ts">
  // Pure-SSR image component: emits a single <img> pointing at a signed,
  // cached, resized URL. With `placeholder`, it also renders a ThumbHash
  // blur-up via the BlurImage island.
  import { getResizedImage, getImagePlaceholder } from './getResizedImage';
  import type { ImageFit, ImageFormat } from './types';
  import BlurImage from './BlurImage.svelte';

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

{#if blur}
  <BlurImage mochi:hydrate src={resized} {blur} {width} {height} {alt} {loading} {decoding} class={className} />
{:else}
  <img src={resized} {width} {height} {alt} {loading} {decoding} class={className} />
{/if}
