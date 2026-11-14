<script lang="ts">
  import Stars from './Stars.svelte';
  import Feed from './Feed.svelte';
</script>

<Stars mochi:defer:visible={{ group: 'lazy', rootMargin: '200px' }} repo="lazy-one" />
<Feed mochi:defer:visible={{ group: 'lazy' }} items={1} />

<Stars mochi:defer:visible={{ group: 'mixed' }} repo="mixed-lazy" />
<Feed mochi:defer={{ group: 'mixed' }} items={1} />
