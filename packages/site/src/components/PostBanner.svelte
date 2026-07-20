<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import CirclePlay from '@lucide/svelte/icons/circle-play';
</script>

<a class="post-banner" href="/blog/this-week-in-svelte/">
  <CirclePlay class="post-banner-icon" size={18} strokeWidth={1.6} aria-hidden="true" />
  <span class="post-banner-text">
    <span class="post-banner-title">Watch the Mochi demo on This Week in Svelte</span>
  </span>
  <ArrowRight class="post-banner-arrow" size={16} strokeWidth={1.8} aria-hidden="true" />
</a>

<style>
  .post-banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    padding: 0.7rem 1rem;
    margin-bottom: 1.75rem;
    text-decoration: none;
    color: inherit;
    transition: background 0.12s ease;
  }

  .post-banner:hover {
    background: var(--accent-soft);
  }

  .post-banner :global(.post-banner-icon) {
    flex: none;
    color: var(--accent);
  }

  .post-banner-text {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
  }

  .post-banner-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    transition: color 0.12s ease;
  }

  .post-banner:hover .post-banner-title {
    color: var(--accent-soft-text);
  }

  .post-banner :global(.post-banner-arrow) {
    flex: none;
    color: var(--text-subtle);
    transition: transform 0.18s ease;
  }

  .post-banner:hover :global(.post-banner-arrow) {
    transform: translateX(2px);
  }

  @media (max-width: 640px) {
    .post-banner-title {
      font-size: 0.9rem;
      line-height: 1.35;
    }
  }
</style>
