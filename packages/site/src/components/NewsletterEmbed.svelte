<script lang="ts">
  import SidechainFrame from './SidechainFrame.svelte';

  // The widget itself is served by packages/support.
  let { src, title = 'Subscribe to the Mochi newsletter' }: { src: string; title?: string } = $props();
</script>

<aside class="newsletter-embed" aria-label={title}>
  <SidechainFrame mochi:clientOnly {src} {title}>
    <!-- SSR fallback, wiped on mount. Without JS nothing mounts, so the link stays. -->
    <div class="skeleton" aria-hidden="true"></div>
    <noscript><p class="fallback"><a href={src}>Subscribe to the Mochi newsletter →</a></p></noscript>
  </SidechainFrame>
</aside>

<style>
  .newsletter-embed {
    margin: 3rem 0 0;
  }

  .skeleton {
    min-height: 260px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-muted);
  }

  .fallback {
    margin: 0.75rem 0 0;
  }
</style>
