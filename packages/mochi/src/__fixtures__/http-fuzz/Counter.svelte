<script lang="ts">
  let { label = 'n' }: { label?: string } = $props();
  let n = $state(0);
</script>

<button class="fuzz-counter" onclick={() => n++}>{label} {n}</button>

<style>
  .fuzz-counter {
    color: rebeccapurple;
  }
</style>
