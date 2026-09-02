<script lang="ts">
  import type { Snippet } from 'svelte';

  let { name }: { name: string; children?: Snippet } = $props();
</script>

<p>Welcome back, {name}!</p>
