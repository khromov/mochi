<script lang="ts">
  import Counter from './Counter.svelte';

  let { name }: { name: string } = $props();
</script>

<div class="card">
  <h1>Hello {name}</h1>
  <Counter mochi:hydrate />
</div>
