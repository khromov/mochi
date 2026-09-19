<script lang="ts">
  import type { Snippet } from 'svelte';

  let { start = 0 }: { start?: number; children?: Snippet } = $props();
  // svelte-ignore state_referenced_locally
  let n = $state(start);
</script>

<button class="counter" onclick={() => n++}>count {n}</button>
