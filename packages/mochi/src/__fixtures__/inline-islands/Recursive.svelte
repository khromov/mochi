<script lang="ts">
  import Recursive from './Recursive.svelte';
  let { depth }: { depth: number } = $props();
</script>

<p data-depth={depth}>depth {depth}</p>
<Recursive mochi:defer depth={depth + 1} />
