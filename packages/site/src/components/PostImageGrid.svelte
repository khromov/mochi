<script lang="ts">
  import { Image } from 'mochi-framework/image';

  // Every tile below is the same source photo run through a different named size
  // from this site's own `image.sizes` config — the grid is served by the very
  // endpoint the post is describing.
  const tiles: { size: string; label: string }[] = [
    { size: 'thumb', label: 'thumb' },
    { size: 'grayscale', label: 'grayscale' },
    { size: 'saturate', label: 'saturate' },
    { size: 'brighten', label: 'brighten' },
    { size: 'rotate90', label: 'rotate90' },
    { size: 'flip', label: 'flip' },
  ];

  const gallery = Array.from({ length: 6 }, (_, i) => `https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-${i + 1}.jpg`);
</script>

<div class="grid">
  {#each tiles as tile, i (tile.size)}
    <figure>
      <Image src={gallery[i]} size={tile.size} alt={`A photo transformed with the "${tile.label}" size`} />
      <figcaption>{tile.label}</figcaption>
    </figure>
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem;
    margin: 1.25rem 0;
  }

  figure {
    margin: 0;
    text-align: center;
  }

  figure :global(img) {
    width: 100%;
    height: auto;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    display: block;
  }

  figcaption {
    margin-top: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
