<script>
  let { html } = $props();
</script>

<div class="snippet">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted server-side Shiki output -->
  {@html html}
</div>

<style>
  .snippet {
    margin: 0.5rem 0 0.75rem;
    font-size: 0.8rem;
  }
  .snippet :global(pre) {
    margin: 0;
    padding: 0.6rem 0.85rem;
    border-radius: var(--radius-sm);
    overflow-x: auto;
  }
</style>
