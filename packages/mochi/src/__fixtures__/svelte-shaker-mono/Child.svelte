<script>
  import Heavy from './Heavy.svelte';
  let { a = 0, b = 0 } = $props();
</script>

{#if a === 1 && b === 1}<Heavy />{/if}
<p>base</p>
