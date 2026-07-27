<script lang="ts">
  import { Youtube } from 'svelte-youtube-lite';

  // A bare package specifier can't carry a `mochi:hydrate` directive, so island
  // usage goes through this local wrapper.
  let { id, title, start }: { id: string; title?: string; start?: number } = $props();
</script>

<div class="youtube-embed">
  <Youtube {id} {title} params={start ? { start: String(start) } : {}} />
</div>

<style>
  .youtube-embed {
    margin: 1rem 0 1.25rem;
    border-radius: var(--radius-md);
    overflow: hidden;
  }
</style>
