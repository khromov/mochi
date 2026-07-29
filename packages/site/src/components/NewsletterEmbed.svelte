<script lang="ts">
  import SidechainFrame from './SidechainFrame.svelte';

  // The widget itself lives at support.mochi.fast (packages/support) — it needs the
  // SQLite database and SMTP transport this site deliberately doesn't carry.
  let { src, title = 'Subscribe to the Mochi newsletter' }: { src: string; title?: string } = $props();
</script>

<aside class="newsletter-embed" aria-label={title}>
  <SidechainFrame mochi:clientOnly {src} {title}>
    <!-- SSR fallback, wiped the moment the island mounts: the skeleton reserves the
         widget's height so nothing jumps, and the link is the whole no-JS path
         (a browser without JS never mounts, so it stays). -->
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
