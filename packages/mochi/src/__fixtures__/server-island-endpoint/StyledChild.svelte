<script lang="ts">
  let { label = 'child' } = $props();
  let n = $state(0);
</script>

<button class="styled-child" onclick={() => n++}>{label} {n}</button>

<style>
  .styled-child {
    color: rebeccapurple;
  }
</style>
