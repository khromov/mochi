<script lang="ts">
  // Hydratable island that performs the blur-up swap. The image renders on top
  // and is visible without JS; once hydrated, the blur layer behind it fades
  // out on load, so the effect degrades gracefully.
  let {
    src,
    blur,
    width,
    height,
    alt = '',
    loading = 'lazy',
    decoding = 'async',
    class: className = undefined,
  }: {
    src: string;
    blur: string;
    width?: number;
    height?: number;
    alt?: string;
    loading?: 'lazy' | 'eager';
    decoding?: 'async' | 'sync' | 'auto';
    class?: string;
  } = $props();

  let loaded = $state(false);
</script>

<span class="mochi-image {className ?? ''}">
  <span class="mochi-image__blur" class:mochi-image__blur--hidden={loaded} style:background-image="url({blur})" aria-hidden="true"></span>
  <img {src} {width} {height} {alt} {loading} {decoding} onload={() => (loaded = true)} />
</span>

<style>
  .mochi-image {
    position: relative;
    display: inline-block;
    line-height: 0;
    overflow: hidden;
  }
  .mochi-image__blur {
    position: absolute;
    inset: 0;
    z-index: 0;
    background-size: cover;
    background-position: center;
    transition: opacity 0.4s ease;
  }
  .mochi-image__blur--hidden {
    opacity: 0;
  }
  .mochi-image img {
    position: relative;
    z-index: 1;
    display: block;
    max-width: 100%;
    height: auto;
  }
</style>
