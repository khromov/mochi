<script lang="ts">
  let { name }: { name: string } = $props();
  let count = $state(0);
</script>

<p>
  Hello {name}!
  <button onclick={() => count++}>Clicked {count} {count === 1 ? 'time' : 'times'}</button>
</p>

<style>
  button {
    margin-left: 0.5rem;
  }
</style>
