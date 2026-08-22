<script lang="ts">
  import { Image } from 'mochi-framework/image';
  import { getImagePlaceholder } from 'mochi-framework';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';

  let { src }: { src: string } = $props();

  // The blur is only readable server-side and the loaded <Image> paints over its own
  // placeholder, so the two states can't be photographed from one live render — resolving the hash here shows them side by side instead.
  // svelte-ignore state_referenced_locally
  const blur = await getImagePlaceholder(src);
</script>

<div class="subject">
  <span class="placeholder" style:background-image="url({blur})" role="img" aria-label="ThumbHash blur placeholder"></span>
  <span class="arrow"><ArrowRight size={32} aria-hidden="true" /></span>
  <Image {src} size="hero" placeholder alt="The loaded image" />
</div>

<style>
  /* The frame sizes this from the subject's declared natural width, so it must not
     set a width of its own. */
  .subject {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }

  /* Mirrors the hero size (600x400) so the blur and the loaded image share a box. */
  .placeholder {
    width: 600px;
    flex: none;
    aspect-ratio: 3 / 2;
    background-size: cover;
    background-position: center;
    border-radius: 8px;
  }

  .arrow {
    color: #8a8a8a;
    line-height: 0;
  }

  .subject :global(img) {
    border-radius: 8px;
    display: block;
  }
</style>
