<script lang="ts">
  import Middle from './Middle.svelte';
  let clicks = $state(0);
</script>

<button data-marker="deep-top" onclick={() => clicks++}>deep: {clicks}</button>
<Middle />
