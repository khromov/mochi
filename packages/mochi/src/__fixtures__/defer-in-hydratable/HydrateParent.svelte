<script lang="ts">
  import Leaf from './Leaf.svelte';
  let count = $state(0);
</script>

<button onclick={() => count++}>count: {count}</button>
<Leaf mochi:defer />
