<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MochiDirectives } from 'mochi-framework';

  let { name }: { name: string; children?: Snippet } & MochiDirectives = $props();
</script>

<p>Welcome back, {name}!</p>
