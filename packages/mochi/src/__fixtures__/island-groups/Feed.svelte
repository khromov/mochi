<script lang="ts">
  import type { Snippet } from 'svelte';

  let { items = 2 }: { items?: number; children?: Snippet } = $props();
</script>

<ul class="feed">
  {#each Array.from({ length: items }, (_, i) => i) as i (i)}
    <li>item {i}</li>
  {/each}
</ul>
