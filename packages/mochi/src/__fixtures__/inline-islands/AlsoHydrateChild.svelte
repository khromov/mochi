<script lang="ts">
  let { label }: { label: string } = $props();
  let clicks = $state(0);
</script>

<button data-marker="ah-child" onclick={() => clicks++}>{label}: {clicks}</button>
