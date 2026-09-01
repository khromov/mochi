<script lang="ts">
  import type { MochiDirectives } from 'mochi-framework';
  let { initialLikes }: { initialLikes: number } & MochiDirectives = $props();
  let likes = $state(initialLikes);
</script>

<button onclick={() => likes++}>♥ {likes}</button>
