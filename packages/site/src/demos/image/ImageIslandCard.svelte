<script lang="ts">
  import { Image } from 'mochi-framework/image';
  import Heart from '@lucide/svelte/icons/heart';

  // <Image> detects the hydrating island by itself via isHydratable(), so its
  // server-minted URL is serialized for hydration without any prop forwarding.
  let { src }: { src: string } = $props();
  let likes = $state(42);
</script>

<div class="card">
  <Image {src} size="card" placeholder alt="A photo rendered inside a hydrated island" />
  <button class="card__btn" onclick={() => likes++}>
    <Heart size={16} aria-hidden="true" />
    {likes}
    {likes === 1 ? 'like' : 'likes'}
  </button>
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }
  .card :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-md);
  }
  .card__btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    /* Explicit color: the UA's `buttontext` default can render white under
       `color-scheme: light dark` even when the site theme is light. */
    color: var(--text);
    font-family: var(--font-sans);
    cursor: pointer;
  }
  .card__btn:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-hover);
  }
</style>
