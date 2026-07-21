<script lang="ts">
  import { Image } from 'mochi-framework/image';

  // Every tile below is the same source photo run through a different named size
  // from this site's own `image.sizes` config — the grid is served by the very
  // endpoint the post is describing.
  const photo = (n: number) => `https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-${n}.jpg`;

  const tiles: { size: string; src: string }[] = [
    { size: 'thumb', src: photo(1) },
    { size: 'grayscale', src: photo(2) },
    { size: 'saturate', src: photo(3) },
    { size: 'brighten', src: photo(4) },
    { size: 'rotate90', src: photo(5) },
    { size: 'flip', src: photo(6) },
  ];
</script>

<div class="grid">
  {#each tiles as tile (tile.size)}
    <figure>
      <Image src={tile.src} size={tile.size} alt={`A photo transformed with the "${tile.size}" size`} />
      <figcaption>{tile.size}</figcaption>
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
